const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const supabase = require('./supabaseClient');
const designRestaurant = require('./restaurantDesignService');

const ROLES = ['owner', 'manager', 'employee'];

const PERMISSIONS_PAR_ROLE = {
  employee: ['scan'],
  manager: [
    'dashboard', 'statistics', 'clients', 'scan', 'referral_view',
    'fraud_view', 'fraud_review', 'notifications', 'marketing_view'
  ],
  owner: [
    'dashboard', 'statistics', 'clients', 'scan', 'referral_view',
    'referral_manage', 'fraud_view', 'fraud_review', 'fraud_manage',
    'notifications', 'design_view', 'design_manage', 'team_manage',
    'cards_sync', 'marketing_view', 'marketing_manage'
  ],
  super_admin: ['*']
};

const COOKIE_ACCES = 'bravocard_access';
const COOKIE_REFRESH = 'bravocard_refresh';
const STATUTS_ABONNEMENT_ACTIFS = ['active', 'trialing'];
const DELAI_GRACE_IMPAYE_JOURS = 7;

function creerClientAuth() {
  const cle = process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_KEY;

  if (!process.env.SUPABASE_URL || !cle) {
    throw new Error('La connexion sécurisée Supabase Auth n’est pas configurée.');
  }

  return createClient(process.env.SUPABASE_URL, cle, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

function lireCookies(req) {
  return String(req.headers.cookie || '')
    .split(';')
    .map(partie => partie.trim())
    .filter(Boolean)
    .reduce((cookies, partie) => {
      const separation = partie.indexOf('=');
      if (separation < 1) return cookies;
      const nom = partie.slice(0, separation);
      const valeur = partie.slice(separation + 1);
      try {
        cookies[nom] = decodeURIComponent(valeur);
      } catch {
        cookies[nom] = valeur;
      }
      return cookies;
    }, {});
}

function extraireJetonAcces(req) {
  const autorisation = String(req.headers.authorization || '');
  if (/^Bearer\s+/i.test(autorisation)) {
    return autorisation.replace(/^Bearer\s+/i, '').trim();
  }
  return lireCookies(req)[COOKIE_ACCES] || null;
}

function optionsCookie(maxAge) {
  return {
    httpOnly: true,
    secure: Boolean(process.env.RENDER || process.env.NODE_ENV === 'production'),
    sameSite: 'lax',
    path: '/',
    maxAge
  };
}

function ecrireSession(res, session) {
  if (!session?.access_token || !session?.refresh_token) {
    throw new Error('La session reçue est incomplète.');
  }
  res.cookie(COOKIE_ACCES, session.access_token, optionsCookie(60 * 60 * 1000));
  res.cookie(COOKIE_REFRESH, session.refresh_token, optionsCookie(30 * 24 * 60 * 60 * 1000));
  res.set('Cache-Control', 'private, no-store');
}

function effacerSession(res) {
  const options = optionsCookie(0);
  delete options.maxAge;
  res.clearCookie(COOKIE_ACCES, options);
  res.clearCookie(COOKIE_REFRESH, options);
  res.set('Cache-Control', 'private, no-store');
}

function normaliserEmail(email) {
  const valeur = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valeur) || valeur.length > 254) {
    throw new Error('Saisissez une adresse email valide.');
  }
  return valeur;
}

function normaliserNom(nom) {
  const valeur = String(nom || '').trim().replace(/\s+/g, ' ');
  if (valeur.length < 2 || valeur.length > 100) {
    throw new Error('Le nom doit contenir entre 2 et 100 caractères.');
  }
  return valeur;
}

function verifierMotDePasse(motDePasse) {
  const valeur = String(motDePasse || '');
  if (valeur.length < 10 || valeur.length > 128) {
    throw new Error('Le mot de passe doit contenir au moins 10 caractères.');
  }
  return valeur;
}

function genererMotDePasseTemporaire() {
  return `${crypto.randomBytes(12).toString('base64url')}aA1!`;
}

function permissionsPourRole(role) {
  return [...(PERMISSIONS_PAR_ROLE[role] || [])];
}

const LIMITES_ETABLISSEMENTS_PAR_PLAN = Object.freeze({ starter: 1, pro: 1, premium: 5 });

function abonnementActif(profil) {
  return Boolean(STATUTS_ABONNEMENT_ACTIFS.includes(profil?.stripe_subscription_status));
}

function accesFacturationRestaurant(restaurant) {
  const statut = String(restaurant?.billing_status || 'inactive');
  if (STATUTS_ABONNEMENT_ACTIFS.includes(statut)) return true;
  if (statut !== 'past_due') return false;
  const echeance = restaurant?.billing_current_period_end
    ? new Date(restaurant.billing_current_period_end).getTime()
    : 0;
  return echeance + DELAI_GRACE_IMPAYE_JOURS * 24 * 60 * 60 * 1000 > Date.now();
}

function limiteEtablissements(profil) {
  if (!abonnementActif(profil)) return LIMITES_ETABLISSEMENTS_PAR_PLAN.starter;
  return LIMITES_ETABLISSEMENTS_PAR_PLAN[profil?.subscription_plan] || LIMITES_ETABLISSEMENTS_PAR_PLAN.starter;
}

function abonnementPremiumActif(profil) {
  return Boolean(profil?.subscription_plan === 'premium' && abonnementActif(profil));
}

function possedePermission(contexte, role, permission) {
  if (contexte?.profil?.is_super_admin) return true;
  return permissionsPourRole(role).includes(permission);
}

async function connexion(email, motDePasse) {
  const clientAuth = creerClientAuth();
  const { data, error } = await clientAuth.auth.signInWithPassword({
    email: normaliserEmail(email),
    password: verifierMotDePasse(motDePasse)
  });
  if (error || !data.session) {
    throw new Error('Email ou mot de passe incorrect.');
  }
  return data;
}

async function rafraichirSession(req) {
  const refreshToken = lireCookies(req)[COOKIE_REFRESH];
  if (!refreshToken) throw new Error('Votre session a expiré. Reconnectez-vous.');
  const clientAuth = creerClientAuth();
  const { data, error } = await clientAuth.auth.refreshSession({
    refresh_token: refreshToken
  });
  if (error || !data.session) {
    throw new Error('Votre session a expiré. Reconnectez-vous.');
  }
  return data;
}

async function obtenirContexteUtilisateur(req) {
  if (req.bravocardContexteUtilisateur !== undefined) {
    return req.bravocardContexteUtilisateur;
  }

  const jeton = extraireJetonAcces(req);
  if (!jeton) {
    req.bravocardContexteUtilisateur = null;
    return null;
  }

  const { data: resultatUtilisateur, error: erreurUtilisateur } =
    await supabase.auth.getUser(jeton);
  const utilisateur = resultatUtilisateur?.user;
  if (erreurUtilisateur || !utilisateur) {
    req.bravocardContexteUtilisateur = null;
    return null;
  }

  const { data: profil, error: erreurProfil } = await supabase
    .from('user_profiles')
    .select('user_id, email, full_name, is_super_admin, subscription_plan, stripe_customer_id, stripe_subscription_id, stripe_subscription_status, stripe_price_id, subscription_current_period_end')
    .eq('user_id', utilisateur.id)
    .maybeSingle();
  if (erreurProfil) throw erreurProfil;
  if (!profil) {
    req.bravocardContexteUtilisateur = null;
    return null;
  }

  let etablissements;
  let etablissementsBloques = [];
  if (profil.is_super_admin) {
    const { data, error } = await supabase
      .from('restaurants')
      .select('id, nom, slug, actif, deleted_at, billing_status, billing_locked_at, billing_current_period_end')
      .is('deleted_at', null)
      .order('nom');
    if (error) throw error;
    etablissements = (data || []).map(restaurant => ({
      ...restaurant,
      role: 'super_admin',
      permissions: permissionsPourRole('super_admin')
    }));
  } else {
    const { data, error } = await supabase
      .from('restaurant_memberships')
      .select('restaurant_id, role, active, created_at, restaurants(id, nom, slug, actif, deleted_at, billing_status, billing_locked_at, billing_current_period_end)')
      .eq('user_id', utilisateur.id)
      .eq('active', true)
      .order('created_at');
    if (error) throw error;
    const tousLesEtablissements = (data || [])
      .filter(entree => entree.restaurants && !entree.restaurants.deleted_at)
      .map(entree => ({
        ...entree.restaurants,
        role: entree.role,
        billing_locked: !accesFacturationRestaurant(entree.restaurants),
        permissions: accesFacturationRestaurant(entree.restaurants)
          ? permissionsPourRole(entree.role)
          : [],
        membership_created_at: entree.created_at
      }))
      .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));

    const appartenancesProprietaire = tousLesEtablissements
      .filter(entree => entree.role === 'owner')
      .sort((a, b) => new Date(a.membership_created_at) - new Date(b.membership_created_at));

    const limiteEtablissementsProprietaire = limiteEtablissements(profil);
    if (appartenancesProprietaire.length > limiteEtablissementsProprietaire) {
      const idsAutorises = new Set(
        appartenancesProprietaire.slice(0, limiteEtablissementsProprietaire).map(entree => entree.id)
      );
      etablissementsBloques = appartenancesProprietaire
        .filter(entree => !idsAutorises.has(entree.id))
        .map(entree => ({ ...entree, verrouille_abonnement: true }));
      const idsBloques = new Set(etablissementsBloques.map(entree => entree.id));
      etablissements = tousLesEtablissements.filter(entree => !idsBloques.has(entree.id));
    } else {
      etablissements = tousLesEtablissements;
    }
  }

  const contexte = { utilisateur, profil, etablissements, etablissementsBloques };
  req.bravocardContexteUtilisateur = contexte;
  return contexte;
}

async function creerJetonReinitialisation(userId) {
  const jeton = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(jeton).digest('hex');
  const expiration = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  await supabase
    .from('password_reset_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('used_at', null);

  const { error } = await supabase.from('password_reset_tokens').insert({
    user_id: userId,
    token_hash: tokenHash,
    expires_at: expiration
  });
  if (error) throw error;
  return jeton;
}

async function demanderReinitialisation(email) {
  const emailNormalise = normaliserEmail(email);
  const { data: profil, error } = await supabase
    .from('user_profiles')
    .select('user_id, email, full_name')
    .eq('email', emailNormalise)
    .maybeSingle();
  if (error) throw error;
  if (!profil) return null;
  return { profil, jeton: await creerJetonReinitialisation(profil.user_id) };
}

async function reinitialiserMotDePasse(jeton, nouveauMotDePasse) {
  const valeur = String(jeton || '').trim();
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(valeur)) {
    throw new Error('Ce lien de réinitialisation est invalide ou expiré.');
  }
  const tokenHash = crypto.createHash('sha256').update(valeur).digest('hex');
  const { data: entree, error } = await supabase
    .from('password_reset_tokens')
    .select('id, user_id, expires_at, used_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (error) throw error;
  if (!entree || entree.used_at || new Date(entree.expires_at).getTime() <= Date.now()) {
    throw new Error('Ce lien de réinitialisation est invalide ou expiré.');
  }

  const password = verifierMotDePasse(nouveauMotDePasse);
  const { error: erreurMotDePasse } = await supabase.auth.admin.updateUserById(
    entree.user_id,
    { password }
  );
  if (erreurMotDePasse) throw erreurMotDePasse;

  const { error: erreurJeton } = await supabase
    .from('password_reset_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('user_id', entree.user_id)
    .is('used_at', null);
  if (erreurJeton) throw erreurJeton;
  return entree.user_id;
}

async function accesEtablissement(req, restaurant, permission) {
  const contexte = await obtenirContexteUtilisateur(req);
  if (!contexte) return null;
  const etablissement = contexte.etablissements.find(
    entree => entree.id === restaurant.id && entree.actif !== false
  );
  if (!etablissement) return null;
  if (!contexte.profil.is_super_admin && etablissement.billing_locked) {
    return { abonnementBloque: true, contexte, etablissement };
  }
  if (permission && !possedePermission(contexte, etablissement.role, permission)) {
    return { interdit: true, contexte, etablissement };
  }
  return { contexte, etablissement };
}

async function journaliser(action, contexte, restaurantId = null, details = {}) {
  try {
    await supabase.from('access_audit_logs').insert({
      user_id: contexte?.utilisateur?.id || null,
      restaurant_id: restaurantId,
      action,
      details
    });
  } catch (erreur) {
    console.error('Journal d’accès indisponible:', erreur.message);
  }
}

async function trouverUtilisateurAuthParEmail(email) {
  // Supabase Auth ne propose pas de filtre email sur listUsers. Cette recherche
  // paginée permet de réparer proprement un ancien compte Auth dont le profil
  // applicatif n'aurait jamais été créé, au lieu de bloquer sur "already exists".
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const utilisateurs = data?.users || [];
    const trouve = utilisateurs.find(utilisateur =>
      String(utilisateur.email || '').trim().toLowerCase() === email
    );
    if (trouve) return trouve;
    if (utilisateurs.length < 1000) break;
  }
  return null;
}

async function creerOuAssocierUtilisateur({
  email,
  fullName,
  restaurantId = null,
  role = null,
  invitedBy = null,
  superAdmin = false
}) {
  const emailNormalise = normaliserEmail(email);
  const nomNormalise = normaliserNom(fullName);
  if (role && !ROLES.includes(role)) throw new Error('Le rôle demandé est invalide.');

  let { data: profil, error: erreurProfil } = await supabase
    .from('user_profiles')
    .select('user_id, email, full_name, is_super_admin, subscription_plan, stripe_subscription_status, subscription_current_period_end')
    .eq('email', emailNormalise)
    .maybeSingle();
  if (erreurProfil) throw erreurProfil;

  let motDePasseTemporaire = null;
  let utilisateurCree = false;
  let identiteAuthCreee = false;

  if (!profil) {
    motDePasseTemporaire = genererMotDePasseTemporaire();
    let { data: creation, error: erreurCreation } = await supabase.auth.admin.createUser({
      email: emailNormalise,
      password: motDePasseTemporaire,
      email_confirm: true,
      user_metadata: { full_name: nomNormalise },
      app_metadata: { bravocard_account: true }
    });
    if (erreurCreation || !creation?.user) {
      const identiteExistante = await trouverUtilisateurAuthParEmail(emailNormalise);
      if (!identiteExistante) {
        throw new Error(erreurCreation?.message || 'Impossible de créer ce compte.');
      }
      creation = { user: identiteExistante };
      motDePasseTemporaire = null;
    } else {
      identiteAuthCreee = true;
      utilisateurCree = true;
    }
    const { data: nouveauProfil, error: erreurNouveauProfil } = await supabase
      .from('user_profiles')
      .insert({
        user_id: creation.user.id,
        email: emailNormalise,
        full_name: nomNormalise,
        is_super_admin: superAdmin
      })
      .select('user_id, email, full_name, is_super_admin, subscription_plan, stripe_subscription_status, subscription_current_period_end')
      .single();
    if (erreurNouveauProfil) {
      if (identiteAuthCreee) await supabase.auth.admin.deleteUser(creation.user.id);
      throw erreurNouveauProfil;
    }
    profil = nouveauProfil;
  } else if (superAdmin && !profil.is_super_admin) {
    const { data, error } = await supabase
      .from('user_profiles')
      .update({ is_super_admin: true, updated_at: new Date().toISOString() })
      .eq('user_id', profil.user_id)
      .select('user_id, email, full_name, is_super_admin')
      .single();
    if (error) throw error;
    profil = data;
  }

  let appartenance = null;
  if (restaurantId && role) {
    const { data, error } = await supabase
      .from('restaurant_memberships')
      .upsert({
        restaurant_id: restaurantId,
        user_id: profil.user_id,
        role,
        active: true,
        invited_by: invitedBy,
        updated_at: new Date().toISOString()
      }, { onConflict: 'restaurant_id,user_id' })
      .select('id, restaurant_id, user_id, role, active')
      .single();
    if (error) {
      if (identiteAuthCreee) await supabase.auth.admin.deleteUser(profil.user_id);
      throw error;
    }
    appartenance = data;

    if (role === 'owner') {
      const statut = profil.stripe_subscription_status || 'inactive';
      const ouvert = STATUTS_ABONNEMENT_ACTIFS.includes(statut);
      const { error: erreurFacturation } = await supabase
        .from('restaurants')
        .update({
          billing_owner_user_id: profil.user_id,
          billing_status: statut,
          billing_current_period_end: profil.subscription_current_period_end || null,
          billing_locked_at: ouvert ? null : new Date().toISOString(),
          billing_updated_at: new Date().toISOString()
        })
        .eq('id', restaurantId);
      if (erreurFacturation) throw erreurFacturation;
    }
  }

  return {
    profil,
    appartenance,
    nouveau_compte: utilisateurCree,
    mot_de_passe_temporaire: motDePasseTemporaire
  };
}

async function creerSlugDisponible(nom, slugDemande) {
  const base = designRestaurant.normaliserSlug(slugDemande || nom);
  for (let tentative = 0; tentative < 6; tentative += 1) {
    const suffixe = tentative === 0 ? '' : `-${crypto.randomBytes(2).toString('hex')}`;
    const candidat = `${base.slice(0, Math.max(1, 70 - suffixe.length))}${suffixe}`;
    const { data, error } = await supabase
      .from('restaurants')
      .select('id')
      .eq('slug', candidat)
      .maybeSingle();
    if (error) throw error;
    if (!data) return candidat;
  }
  throw new Error('Impossible de créer un lien unique pour cet établissement.');
}

async function inscrireProprietaire({
  email,
  fullName,
  password,
  restaurantName,
  slug = '',
  plan = 'starter'
}) {
  const emailNormalise = normaliserEmail(email);
  const nomNormalise = normaliserNom(fullName);
  const motDePasse = verifierMotDePasse(password);
  const nomRestaurant = designRestaurant.nettoyerTexte(
    restaurantName,
    80,
    'Le nom de l’établissement'
  );
  if (!['starter', 'pro', 'premium'].includes(plan)) {
    throw new Error('Le forfait demandé est invalide.');
  }

  const { data: profilExistant, error: erreurProfil } = await supabase
    .from('user_profiles')
    .select('user_id')
    .eq('email', emailNormalise)
    .maybeSingle();
  if (erreurProfil) throw erreurProfil;
  if (profilExistant) {
    const erreur = new Error('Un compte existe déjà avec cette adresse. Connectez-vous pour choisir votre offre.');
    erreur.code = 'ACCOUNT_EXISTS';
    throw erreur;
  }

  const slugDisponible = await creerSlugDisponible(nomRestaurant, slug);
  const { data: creation, error: erreurCreation } = await supabase.auth.admin.createUser({
    email: emailNormalise,
    password: motDePasse,
    email_confirm: true,
    user_metadata: { full_name: nomNormalise },
    app_metadata: { bravocard_account: true, bravocard_role: 'owner' }
  });
  if (erreurCreation || !creation.user) {
    throw new Error(erreurCreation?.message || 'Impossible de créer votre compte.');
  }

  let restaurant = null;
  try {
    const { data: profil, error: erreurNouveauProfil } = await supabase
      .from('user_profiles')
      .insert({
        user_id: creation.user.id,
        email: emailNormalise,
        full_name: nomNormalise,
        subscription_plan: plan,
        stripe_subscription_status: 'incomplete',
        subscription_updated_at: new Date().toISOString()
      })
      .select('user_id, email, full_name, is_super_admin, subscription_plan, stripe_customer_id, stripe_subscription_id, stripe_subscription_status')
      .single();
    if (erreurNouveauProfil) throw erreurNouveauProfil;

    const codeAcces = designRestaurant.genererCodeAcces();
    const { data: nouveauRestaurant, error: erreurRestaurant } = await supabase
      .from('restaurants')
      .insert({
        nom: nomRestaurant,
        slug: slugDisponible,
        design_access_token_hash: designRestaurant.hacherCodeAcces(codeAcces),
        apple_pro_design: plan === 'premium',
        billing_owner_user_id: creation.user.id,
        billing_status: 'incomplete',
        billing_locked_at: new Date().toISOString(),
        billing_updated_at: new Date().toISOString()
      })
      .select('id, nom, slug')
      .single();
    if (erreurRestaurant) throw erreurRestaurant;
    restaurant = nouveauRestaurant;

    const { error: erreurAppartenance } = await supabase
      .from('restaurant_memberships')
      .insert({
        restaurant_id: restaurant.id,
        user_id: creation.user.id,
        role: 'owner',
        active: true
      });
    if (erreurAppartenance) throw erreurAppartenance;

    return { profil, restaurant };
  } catch (erreur) {
    if (restaurant?.id) {
      await supabase.from('restaurants').delete().eq('id', restaurant.id);
    }
    await supabase.auth.admin.deleteUser(creation.user.id);
    throw erreur;
  }
}

async function listerEquipe(restaurantId) {
  const { data: appartenances, error } = await supabase
    .from('restaurant_memberships')
    .select('id, user_id, role, active, created_at')
    .eq('restaurant_id', restaurantId)
    .order('created_at');
  if (error) throw error;

  const ids = (appartenances || []).map(entree => entree.user_id);
  if (ids.length === 0) return [];
  const { data: profils, error: erreurProfils } = await supabase
    .from('user_profiles')
    .select('user_id, email, full_name')
    .in('user_id', ids);
  if (erreurProfils) throw erreurProfils;
  const profilsParId = new Map((profils || []).map(profil => [profil.user_id, profil]));
  return appartenances.map(appartenance => ({
    ...appartenance,
    ...(profilsParId.get(appartenance.user_id) || {})
  }));
}

async function modifierAppartenance(restaurantId, membershipId, changements) {
  const { data: actuelle, error: erreurLecture } = await supabase
    .from('restaurant_memberships')
    .select('id, role, active')
    .eq('id', membershipId)
    .eq('restaurant_id', restaurantId)
    .single();
  if (erreurLecture) throw erreurLecture;

  const nouveauRole = changements.role || actuelle.role;
  const nouvelEtat = typeof changements.active === 'boolean'
    ? changements.active
    : actuelle.active;
  if (!ROLES.includes(nouveauRole)) throw new Error('Le rôle demandé est invalide.');

  if (actuelle.role === 'owner' && actuelle.active && (nouveauRole !== 'owner' || !nouvelEtat)) {
    const { count, error } = await supabase
      .from('restaurant_memberships')
      .select('id', { count: 'exact', head: true })
      .eq('restaurant_id', restaurantId)
      .eq('role', 'owner')
      .eq('active', true);
    if (error) throw error;
    if (Number(count || 0) <= 1) {
      throw new Error('Un établissement doit toujours conserver au moins un propriétaire actif.');
    }
  }

  const { data, error } = await supabase
    .from('restaurant_memberships')
    .update({ role: nouveauRole, active: nouvelEtat, updated_at: new Date().toISOString() })
    .eq('id', membershipId)
    .eq('restaurant_id', restaurantId)
    .select('id, user_id, role, active')
    .single();
  if (error) throw error;
  return data;
}

module.exports = {
  ROLES,
  PERMISSIONS_PAR_ROLE,
  normaliserEmail,
  normaliserNom,
  verifierMotDePasse,
  permissionsPourRole,
  abonnementPremiumActif,
  abonnementActif,
  accesFacturationRestaurant,
  limiteEtablissements,
  possedePermission,
  connexion,
  rafraichirSession,
  ecrireSession,
  effacerSession,
  obtenirContexteUtilisateur,
  accesEtablissement,
  creerOuAssocierUtilisateur,
  inscrireProprietaire,
  listerEquipe,
  modifierAppartenance,
  journaliser,
  creerJetonReinitialisation,
  demanderReinitialisation,
  reinitialiserMotDePasse
};
