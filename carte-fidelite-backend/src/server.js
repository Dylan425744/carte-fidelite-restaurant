require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');
const crypto = require('crypto');

const supabase = require('./supabaseClient');
const wallet = require('./walletService');
const appleWallet = require('./appleWalletService');
const email = require('./emailService');
const designRestaurant = require('./restaurantDesignService');
const referral = require('./referralService');
const antiFraude = require('./antiFraudService');
const analytics = require('./analyticsService');
const auth = require('./authService');
const billing = require('./billingService');

const app = express();
app.use(cors());

// Stripe exige le corps brut pour vérifier cryptographiquement la signature.
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const type = await billing.traiterWebhook(req.body, req.headers['stripe-signature']);
    res.json({ recu: true, type });
  } catch (erreur) {
    console.error('Webhook Stripe refusé:', erreur.message);
    res.status(400).json({ erreur: 'Signature Stripe invalide.' });
  }
});

app.use(express.json({ limit: '3mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const CHAMPS_RESTAURANT = [
  'id',
  'nom',
  'slug',
  'seuil_recompense',
  'points_per_scan',
  'description_recompense',
  'actif',
  'design_enabled',
  'design_access_token_hash',
  'apple_pro_design',
  'apple_color_preset',
  'apple_logo_text',
  'apple_points_label',
  'apple_card_label',
  'apple_custom_color',
  'apple_logo_url',
  'apple_strip_url',
  'apple_icon_url',
  'apple_program_name',
  'apple_reward_text',
  'apple_terms',
  'design_updated_at',
  'last_notification_title',
  'last_notification_message',
  'last_notification_sent_at',
  'notification_history',
  'notification_sending',
  'deleted_at',
  'deleted_by',
  'deletion_reason',
  'restored_at',
  'active_before_delete',
  'billing_owner_user_id',
  'billing_status',
  'billing_current_period_end',
  'billing_locked_at',
  'billing_updated_at',
  'google_wallet_class_id',
  'google_wallet_class_status',
  'google_wallet_design_version',
  'google_wallet_synced_at',
  'google_wallet_sync_error'
].join(', ');

function estAdministrateurHistorique(req) {
  const motDePasse = req.headers['x-dashboard-password'];
  return Boolean(
    process.env.DASHBOARD_PASSWORD &&
    motDePasse === process.env.DASHBOARD_PASSWORD
  );
}

async function exigerAdministrateur(req, res, next) {
  try {
    if (estAdministrateurHistorique(req)) {
      req.bravocardAdmin = { historique: true };
      return next();
    }

    const contexte = await auth.obtenirContexteUtilisateur(req);
    if (!contexte?.profil?.is_super_admin) {
      return res.status(401).json({ erreur: 'Accès réservé au super-administrateur.' });
    }
    req.bravocardAdmin = contexte;
    return next();
  } catch (erreur) {
    console.error(erreur);
    return res.status(401).json({ erreur: 'Session administrateur invalide.' });
  }
}

async function trouverRestaurantParSlug(slug) {
  const slugNormalise = designRestaurant.normaliserSlug(slug);
  const { data, error } = await supabase
    .from('restaurants')
    .select(CHAMPS_RESTAURANT)
    .eq('slug', slugNormalise)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function authentifierEspaceDesign(req, res, permission = 'dashboard') {
  let restaurant;

  try {
    restaurant = await trouverRestaurantParSlug(req.params.slug);
  } catch (erreur) {
    res.status(400).json({ erreur: erreur.message });
    return null;
  }

  if (!restaurant || restaurant.actif === false) {
    res.status(404).json({ erreur: 'Ce commerce est introuvable ou désactivé.' });
    return null;
  }

  if (estAdministrateurHistorique(req)) {
    return {
      restaurant,
      administrateur: true,
      role: 'super_admin',
      permissions: auth.permissionsPourRole('super_admin'),
      historique: true
    };
  }

  const accesCompte = await auth.accesEtablissement(req, restaurant, permission);
  if (accesCompte?.abonnementBloque) {
    res.status(402).json({
      erreur: 'Abonnement inactif. Le propriétaire doit régulariser le paiement depuis Mon compte.',
      code: 'SUBSCRIPTION_REQUIRED'
    });
    return null;
  }
  if (accesCompte?.interdit) {
    res.status(403).json({ erreur: 'Votre rôle ne permet pas cette action.' });
    return null;
  }
  if (accesCompte) {
    return {
      restaurant,
      administrateur: accesCompte.contexte.profil.is_super_admin,
      role: accesCompte.etablissement.role,
      permissions: accesCompte.etablissement.permissions,
      contexte: accesCompte.contexte
    };
  }

  if (restaurant.design_enabled === false) {
    res.status(403).json({ erreur: 'La personnalisation a été désactivée par Bravocard.' });
    return null;
  }

  const code = req.headers['x-restaurant-access-code'];
  if (!designRestaurant.verifierCodeAcces(code, restaurant.design_access_token_hash)) {
    res.status(401).json({ erreur: 'Code d’accès incorrect.' });
    return null;
  }

  return {
    restaurant,
    administrateur: false,
    role: 'owner',
    permissions: auth.permissionsPourRole('owner'),
    historique: true
  };
}

function validerNotification(donnees) {
  const titre = String(donnees.titre || '').trim();
  const message = String(donnees.message || '').trim();
  const plateforme = String(donnees.plateforme || 'toutes').toLowerCase();

  if (!titre || titre.length > 48) {
    throw new Error('Le titre doit contenir entre 1 et 48 caractères.');
  }

  if (!message || message.length > 160) {
    throw new Error('Le message doit contenir entre 1 et 160 caractères.');
  }

  if (!['toutes', 'apple', 'google'].includes(plateforme)) {
    throw new Error('La plateforme choisie est invalide.');
  }

  return { titre, message, plateforme };
}

const tentativesConnexion = new Map();
const tentativesRecuperation = new Map();
const tentativesInscription = new Map();
const tentativesDemo = new Map();

function cleTentativeConnexion(req) {
  const adresse = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')
    .split(',')[0]
    .trim();
  return crypto.createHash('sha256').update(adresse || 'inconnue').digest('hex');
}

function verifierLimiteConnexion(req) {
  const cle = cleTentativeConnexion(req);
  const entree = tentativesConnexion.get(cle);
  const maintenant = Date.now();
  if (!entree || entree.reinitialisation < maintenant) {
    tentativesConnexion.set(cle, { echecs: 0, reinitialisation: maintenant + 15 * 60 * 1000 });
    return cle;
  }
  if (entree.echecs >= 8) {
    throw new Error('Trop de tentatives. Réessayez dans quelques minutes.');
  }
  return cle;
}

function obtenirUrlBase(req) {
  const configuree = String(process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || '')
    .trim()
    .replace(/\/$/, '');
  return configuree || `${req.protocol}://${req.get('host')}`;
}

function verifierLimitePublique(stockage, req, maximum, dureeMinutes) {
  const cle = cleTentativeConnexion(req);
  const maintenant = Date.now();
  const entree = stockage.get(cle);
  if (!entree || entree.reinitialisation < maintenant) {
    stockage.set(cle, { tentatives: 1, reinitialisation: maintenant + dureeMinutes * 60 * 1000 });
    return;
  }
  if (entree.tentatives >= maximum) {
    const erreur = new Error('Trop de demandes. Réessayez dans quelques minutes.');
    erreur.code = 'RATE_LIMIT';
    throw erreur;
  }
  entree.tentatives += 1;
}

function normaliserTelephone(telephone) {
  const valeur = String(telephone || '').trim().replace(/[\s.()-]/g, '');
  if (!/^\+?[0-9]{8,15}$/.test(valeur)) {
    throw new Error('Saisissez un numéro de téléphone valide.');
  }
  return valeur;
}

async function envoyerActivationCompte(req, resultat) {
  if (!resultat.nouveau_compte) return { email_envoye: false, compte_existant: true };
  try {
    const jeton = await auth.creerJetonReinitialisation(resultat.profil.user_id);
    const lien = `${obtenirUrlBase(req)}/reinitialiser-mot-de-passe.html?token=${encodeURIComponent(jeton)}`;
    await email.envoyerEmailAccesCompte(
      resultat.profil.email,
      resultat.profil.full_name,
      lien,
      true
    );
    return { email_envoye: true, compte_existant: false };
  } catch (erreur) {
    console.error('Email d’activation non envoyé:', erreur.message);
    return { email_envoye: false, compte_existant: false };
  }
}

function verifierLimiteRecuperation(req, email) {
  const cle = crypto.createHash('sha256')
    .update(`${cleTentativeConnexion(req)}:${String(email || '').trim().toLowerCase()}`)
    .digest('hex');
  const maintenant = Date.now();
  const entree = tentativesRecuperation.get(cle);
  if (!entree || entree.reinitialisation < maintenant) {
    tentativesRecuperation.set(cle, { tentatives: 1, reinitialisation: maintenant + 30 * 60 * 1000 });
    return;
  }
  if (entree.tentatives >= 3) {
    throw new Error('Trop de demandes. Réessayez dans 30 minutes.');
  }
  entree.tentatives += 1;
}

app.post('/api/public/inscription', async (req, res) => {
  let resultat = null;
  try {
    verifierLimitePublique(tentativesInscription, req, 4, 30);
    if (String(req.body.website || '').trim()) {
      return res.status(201).json({ succes: true });
    }
    const plan = billing.planValide(req.body.plan);
    if (!plan) return res.status(400).json({ erreur: 'Choisissez une offre valide.' });

    resultat = await auth.inscrireProprietaire({
      email: req.body.email,
      fullName: req.body.nom,
      password: req.body.password,
      restaurantName: req.body.restaurant,
      slug: req.body.slug,
      plan
    });
    setImmediate(() => actualiserClasseGoogleEnArrierePlan(resultat.restaurant));
    const connexion = await auth.connexion(req.body.email, req.body.password);
    auth.ecrireSession(res, connexion.session);
    const url = await billing.creerCheckout(
      resultat.profil,
      obtenirUrlBase(req),
      plan,
      { restaurantSlug: resultat.restaurant.slug }
    );
    await auth.journaliser('signup.checkout_created', {
      utilisateur: connexion.user,
      profil: resultat.profil
    }, resultat.restaurant.id, { plan });
    res.status(201).json({
      succes: true,
      url,
      restaurant: resultat.restaurant,
      plan
    });
  } catch (erreur) {
    console.error('Inscription publique:', erreur.message);
    const statut = erreur.code === 'RATE_LIMIT'
      ? 429
      : (erreur.code === 'ACCOUNT_EXISTS' ? 409 : (resultat ? 502 : 400));
    res.status(statut).json({
      erreur: resultat
        ? 'Votre compte et votre établissement sont créés, mais Stripe n’a pas pu s’ouvrir. Connectez-vous pour reprendre le paiement.'
        : erreur.message,
      compte_cree: Boolean(resultat),
      connexion_url: resultat
        ? `/espace-restaurateur.html?restaurant=${encodeURIComponent(resultat.restaurant.slug)}#compte`
        : null
    });
  }
});

app.post('/api/public/demandes-demo', async (req, res) => {
  try {
    verifierLimitePublique(tentativesDemo, req, 5, 60);
    if (String(req.body.website || '').trim()) {
      return res.status(201).json({ succes: true });
    }
    const demande = {
      full_name: auth.normaliserNom(req.body.nom),
      phone: normaliserTelephone(req.body.telephone),
      email: auth.normaliserEmail(req.body.email),
      source: 'site_bravocard'
    };
    const { data, error } = await supabase
      .from('demo_requests')
      .insert(demande)
      .select('id, created_at')
      .single();
    if (error) throw error;
    res.status(201).json({
      succes: true,
      demande: data,
      message: 'Merci. Votre demande a bien été transmise à Bravocard.'
    });
  } catch (erreur) {
    const statut = erreur.code === 'RATE_LIMIT' ? 429 : 400;
    res.status(statut).json({ erreur: erreur.message });
  }
});

app.post('/api/auth/connexion', async (req, res) => {
  let cle;
  try {
    cle = verifierLimiteConnexion(req);
    const resultat = await auth.connexion(req.body.email, req.body.password);
    const contexteFactice = {
      utilisateur: resultat.user,
      profil: { is_super_admin: false }
    };
    auth.ecrireSession(res, resultat.session);
    tentativesConnexion.delete(cle);
    await auth.journaliser('auth.login', contexteFactice, null, { succes: true });
    res.json({ succes: true });
  } catch (erreur) {
    if (cle) {
      const entree = tentativesConnexion.get(cle) || {
        echecs: 0,
        reinitialisation: Date.now() + 15 * 60 * 1000
      };
      entree.echecs += 1;
      tentativesConnexion.set(cle, entree);
    }
    const limite = erreur.message.startsWith('Trop de tentatives');
    res.status(limite ? 429 : 401).json({ erreur: erreur.message });
  }
});

app.post('/api/auth/mot-de-passe-oublie', async (req, res) => {
  const reponseGenerique = {
    succes: true,
    message: 'Si un compte correspond à cette adresse, un lien sécurisé vient d’être envoyé.'
  };
  try {
    verifierLimiteRecuperation(req, req.body.email);
    const demande = await auth.demanderReinitialisation(req.body.email);
    if (demande) {
      const lien = `${obtenirUrlBase(req)}/reinitialiser-mot-de-passe.html?token=${encodeURIComponent(demande.jeton)}`;
      await email.envoyerEmailAccesCompte(
        demande.profil.email,
        demande.profil.full_name,
        lien,
        false
      );
      await auth.journaliser('auth.password_reset_requested', {
        utilisateur: { id: demande.profil.user_id }
      }, null, {});
    }
    res.json(reponseGenerique);
  } catch (erreur) {
    if (erreur.message.startsWith('Trop de demandes')) {
      return res.status(429).json({ erreur: erreur.message });
    }
    console.error('Récupération de compte:', erreur.message);
    // Ne jamais révéler si une adresse possède ou non un compte.
    res.json(reponseGenerique);
  }
});

app.post('/api/auth/reinitialiser-mot-de-passe', async (req, res) => {
  try {
    const userId = await auth.reinitialiserMotDePasse(req.body.token, req.body.password);
    await auth.journaliser('auth.password_reset_completed', {
      utilisateur: { id: userId }
    }, null, {});
    res.json({ succes: true, message: 'Mot de passe modifié. Vous pouvez vous connecter.' });
  } catch (erreur) {
    res.status(400).json({ erreur: erreur.message });
  }
});

app.post('/api/auth/actualiser', async (req, res) => {
  try {
    const resultat = await auth.rafraichirSession(req);
    auth.ecrireSession(res, resultat.session);
    res.json({ succes: true });
  } catch (erreur) {
    auth.effacerSession(res);
    res.status(401).json({ erreur: erreur.message });
  }
});

app.post('/api/auth/deconnexion', async (req, res) => {
  const contexte = await auth.obtenirContexteUtilisateur(req).catch(() => null);
  auth.effacerSession(res);
  await auth.journaliser('auth.logout', contexte, null, {});
  res.json({ succes: true });
});

app.get('/api/auth/moi', async (req, res) => {
  try {
    const contexte = await auth.obtenirContexteUtilisateur(req);
    if (!contexte) return res.status(401).json({ erreur: 'Session absente ou expirée.' });
    res.set('Cache-Control', 'private, no-store');
    res.json({
      utilisateur: {
        id: contexte.utilisateur.id,
        email: contexte.profil.email,
        nom: contexte.profil.full_name,
        super_admin: contexte.profil.is_super_admin
      },
      etablissements: contexte.etablissements,
      etablissements_bloques: contexte.etablissementsBloques || [],
      abonnement: {
        plan: contexte.profil.is_super_admin ? 'admin' : contexte.profil.subscription_plan,
        statut: contexte.profil.stripe_subscription_status,
        actif: contexte.profil.is_super_admin || auth.abonnementActif(contexte.profil),
        premium_actif: contexte.profil.is_super_admin || auth.abonnementPremiumActif(contexte.profil),
        limite_etablissements: contexte.profil.is_super_admin ? null : auth.limiteEtablissements(contexte.profil),
        forfaits: billing.cataloguePlans(),
        echeance: contexte.profil.subscription_current_period_end,
        stripe_configure: billing.estConfigure(),
        client_stripe: Boolean(contexte.profil.stripe_customer_id),
        abonnement_stripe: Boolean(contexte.profil.stripe_subscription_id)
      }
    });
  } catch (erreur) {
    console.error(erreur);
    res.status(401).json({ erreur: 'Session invalide.' });
  }
});

app.post('/api/auth/changer-mot-de-passe', async (req, res) => {
  try {
    const contexte = await auth.obtenirContexteUtilisateur(req);
    if (!contexte) return res.status(401).json({ erreur: 'Reconnectez-vous.' });
    const motDePasse = auth.verifierMotDePasse(req.body.password);
    const { error } = await supabase.auth.admin.updateUserById(
      contexte.utilisateur.id,
      { password: motDePasse }
    );
    if (error) throw error;
    await auth.journaliser('auth.password_changed', contexte, null, {});
    res.json({ succes: true, message: 'Votre mot de passe a été modifié.' });
  } catch (erreur) {
    res.status(400).json({ erreur: erreur.message });
  }
});

app.post('/api/stripe/checkout', async (req, res) => {
  try {
    const contexte = await auth.obtenirContexteUtilisateur(req);
    if (!contexte) return res.status(401).json({ erreur: 'Reconnectez-vous.' });
    const proprietaire = [...contexte.etablissements, ...(contexte.etablissementsBloques || [])]
      .some(entree => entree.role === 'owner');
    if (!proprietaire || contexte.profil.is_super_admin) {
      return res.status(403).json({ erreur: 'Cette offre est réservée aux propriétaires.' });
    }
    const plan = billing.planValide(req.body.plan) || 'starter';
    const url = await billing.creerCheckout(contexte.profil, obtenirUrlBase(req), plan);
    res.json({ url });
  } catch (erreur) {
    console.error(erreur);
    res.status(400).json({ erreur: erreur.message });
  }
});

app.post('/api/stripe/portail', async (req, res) => {
  try {
    const contexte = await auth.obtenirContexteUtilisateur(req);
    if (!contexte) return res.status(401).json({ erreur: 'Reconnectez-vous.' });
    const url = await billing.creerPortail(contexte.profil, obtenirUrlBase(req));
    res.json({ url });
  } catch (erreur) {
    res.status(400).json({ erreur: erreur.message });
  }
});

app.post('/api/auth/initialiser-super-admin', async (req, res) => {
  try {
    const { count, error } = await supabase
      .from('user_profiles')
      .select('user_id', { count: 'exact', head: true })
      .eq('is_super_admin', true);
    if (error) throw error;

    const contexte = await auth.obtenirContexteUtilisateur(req).catch(() => null);
    const autorise = Number(count || 0) === 0
      ? estAdministrateurHistorique(req)
      : Boolean(contexte?.profil?.is_super_admin);
    if (!autorise) {
      return res.status(403).json({ erreur: 'Initialisation non autorisée.' });
    }

    const resultat = await auth.creerOuAssocierUtilisateur({
      email: req.body.email,
      fullName: req.body.nom,
      superAdmin: true,
      invitedBy: contexte?.utilisateur?.id || null
    });
    await auth.journaliser('admin.super_admin_created', contexte, null, {
      user_id: resultat.profil.user_id
    });
    res.status(201).json({
      succes: true,
      compte: resultat.profil,
      mot_de_passe_temporaire: resultat.mot_de_passe_temporaire
    });
  } catch (erreur) {
    console.error(erreur);
    res.status(400).json({ erreur: erreur.message });
  }
});

function obtenirHistoriqueNotifications(restaurant) {
  return Array.isArray(restaurant.notification_history)
    ? restaurant.notification_history.slice(0, 50)
    : [];
}

async function finaliserCampagne(campagneId, restaurantId, resultat) {
  const { data: restaurant, error: erreurLecture } = await supabase
    .from('restaurants')
    .select('notification_history')
    .eq('id', restaurantId)
    .single();

  if (erreurLecture) throw erreurLecture;

  const historique = Array.isArray(restaurant.notification_history)
    ? restaurant.notification_history
    : [];
  const historiqueMisAJour = historique.map(campagne =>
    campagne.id === campagneId
      ? {
          ...campagne,
          ...resultat,
          completed_at: new Date().toISOString()
        }
      : campagne
  );

  const { error } = await supabase
    .from('restaurants')
    .update({
      notification_history: historiqueMisAJour,
      notification_sending: false
    })
    .eq('id', restaurantId);

  if (error) throw error;
}

async function traiterCampagneWallet(campagne, clients, restaurant) {
  const resultat = {
    statut: 'terminee',
    apple_reussies: 0,
    apple_echecs: 0,
    google_reussies: 0,
    google_echecs: 0
  };

  try {
    for (let index = 0; index < clients.length; index += 5) {
      const lot = clients.slice(index, index + 5);

      await Promise.all(
        lot.map(async client => {
          const envois = [];

          if (
            campagne.plateforme !== 'google' &&
            client.apple_wallet_serial
          ) {
            envois.push(
              appleWallet
                .mettreAJourPasseApple(
                  client.apple_wallet_serial,
                  client,
                  restaurant
                )
                .then(() => {
                  resultat.apple_reussies += 1;
                })
                .catch(erreur => {
                  resultat.apple_echecs += 1;
                  console.error(
                    `Notification Apple impossible pour ${client.id}:`,
                    erreur.message
                  );
                })
            );
          }

          if (campagne.plateforme !== 'apple') {
            envois.push(
              wallet
                .envoyerNotificationWallet(
                  client,
                  campagne.titre,
                  campagne.message,
                  campagne.id
                )
                .then(() => {
                  resultat.google_reussies += 1;
                })
                .catch(erreur => {
                  resultat.google_echecs += 1;
                  console.error(
                    `Notification Google impossible pour ${client.id}:`,
                    erreur.message
                  );
                })
            );
          }

          await Promise.all(envois);
        })
      );
    }

    if (
      resultat.apple_reussies + resultat.google_reussies === 0 &&
      resultat.apple_echecs + resultat.google_echecs > 0
    ) {
      resultat.statut = 'echec';
    } else if (resultat.apple_echecs + resultat.google_echecs > 0) {
      resultat.statut = 'partielle';
    }

    await finaliserCampagne(campagne.id, restaurant.id, resultat);
  } catch (erreur) {
    console.error('Erreur campagne Wallet:', erreur.message);
    try {
      await finaliserCampagne(campagne.id, restaurant.id, {
        ...resultat,
        statut: 'echec'
      });
    } catch (erreurFinalisation) {
      console.error('Erreur finalisation campagne:', erreurFinalisation.message);
    }
  }
}

// Informations publiques minimales utilisées par la page d'inscription.
app.get('/api/restaurants/:slug/public', async (req, res) => {
  try {
    const restaurant = await trouverRestaurantParSlug(req.params.slug);
    if (!restaurant || restaurant.actif === false) {
      return res.status(404).json({ erreur: 'Commerce introuvable.' });
    }

    res.json({ restaurant: { nom: restaurant.nom, slug: restaurant.slug } });
  } catch (erreur) {
    res.status(400).json({ erreur: erreur.message });
  }
});

// Vérifie un code sans exposer les coordonnées personnelles du parrain.
app.get('/api/parrainage/:slug/:code', async (req, res) => {
  try {
    const restaurant = await trouverRestaurantParSlug(req.params.slug);
    if (!restaurant || restaurant.actif === false) {
      return res.status(404).json({ erreur: 'Commerce introuvable.' });
    }

    const invitation = await referral.obtenirInvitation(
      restaurant.id,
      req.params.code
    );

    res.json({
      invitation: {
        code: invitation.code,
        parrain: String(invitation.sponsor.nom || 'Un client').split(/\s+/)[0],
        points_parrain: invitation.sponsor_points,
        points_filleul: invitation.referee_points,
        restaurant: restaurant.nom
      }
    });
  } catch (erreur) {
    res.status(400).json({ erreur: erreur.message });
  }
});

// Espace commerçant. Le code privé reste dans l'en-tête et n'est jamais renvoyé.
function decoderImagePNG(imageData) {
  const correspondance = String(imageData || '').match(/^data:image\/png;base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!correspondance) throw new Error('Le fichier doit être une image PNG.');
  const buffer = Buffer.from(correspondance[1], 'base64');
  if (buffer.length < 24 || buffer.length > 2 * 1024 * 1024) {
    throw new Error('L’image doit peser moins de 2 Mo.');
  }
  const signaturePNG = '89504e470d0a1a0a';
  if (buffer.subarray(0, 8).toString('hex') !== signaturePNG) {
    throw new Error('Le contenu du fichier PNG est invalide.');
  }
  return {
    buffer,
    largeur: buffer.readUInt32BE(16),
    hauteur: buffer.readUInt32BE(20)
  };
}

async function actualiserCartesAppleEnArrierePlan(restaurant) {
  try {
    const { data: clients, error } = await supabase
      .from('clients')
      .select('*')
      .eq('restaurant_id', restaurant.id)
      .not('apple_wallet_serial', 'is', null);
    if (error) throw error;
    for (let index = 0; index < (clients || []).length; index += 5) {
      const lot = clients.slice(index, index + 5);
      await Promise.allSettled(lot.map(client =>
        appleWallet.mettreAJourPasseApple(client.apple_wallet_serial, client, restaurant)
      ));
    }
  } catch (erreur) {
    console.error('Synchronisation du design Apple Wallet:', erreur.message);
  }
}

async function actualiserClasseGoogleEnArrierePlan(restaurant) {
  try {
    await wallet.assurerClasseRestaurant(restaurant, { force: true });
  } catch (erreur) {
    console.error(`Synchronisation du design Google Wallet (${restaurant.slug}):`, erreur.message);
  }
}

app.get('/api/design/:slug', async (req, res) => {
  try {
    const acces = await authentifierEspaceDesign(req, res, 'design_view');
    if (!acces) return;

    res.json({
      restaurant: designRestaurant.serialiserRestaurant(
        acces.restaurant,
        appleWallet.designProDisponible()
      ),
      administrateur: acces.administrateur
    });
  } catch (erreur) {
    console.error(erreur);
    res.status(500).json({ erreur: erreur.message });
  }
});

app.post('/api/design/:slug/image', async (req, res) => {
  try {
    const acces = await authentifierEspaceDesign(req, res, 'design_manage');
    if (!acces) return;
    const proAutorise = Boolean(
      acces.restaurant.apple_pro_design && appleWallet.designProDisponible()
    );
    if (!proAutorise) {
      return res.status(403).json({ erreur: 'La personnalisation WalletWallet Pro n’est pas active.' });
    }
    const type = String(req.body.type || '').toLowerCase();
    if (!['logo', 'strip', 'icon'].includes(type)) {
      return res.status(400).json({ erreur: 'Type d’image inconnu.' });
    }
    const image = decoderImagePNG(req.body.image_data);
    if (type === 'icon' && Math.abs(image.largeur - image.hauteur) > Math.max(image.largeur, image.hauteur) * 0.12) {
      return res.status(400).json({ erreur: 'L’icône doit être carrée.' });
    }
    if (type === 'strip' && image.largeur / image.hauteur < 2.2) {
      return res.status(400).json({ erreur: 'La bannière doit être nettement plus large que haute.' });
    }
    const chemin = `${acces.restaurant.id}/${type}-${Date.now()}.png`;
    const { error } = await supabase.storage
      .from('wallet-assets')
      .upload(chemin, image.buffer, {
        contentType: 'image/png',
        cacheControl: '31536000',
        upsert: false
      });
    if (error) throw error;
    const { data } = supabase.storage.from('wallet-assets').getPublicUrl(chemin);
    res.status(201).json({
      succes: true,
      url: data.publicUrl,
      largeur: image.largeur,
      hauteur: image.hauteur
    });
  } catch (erreur) {
    console.error(erreur);
    res.status(400).json({ erreur: erreur.message });
  }
});

app.put('/api/design/:slug', async (req, res) => {
  try {
    const acces = await authentifierEspaceDesign(req, res, 'design_manage');
    if (!acces) return;

    const proAutorise = Boolean(
      acces.restaurant.apple_pro_design && appleWallet.designProDisponible()
    );
    const miseAJour = designRestaurant.construireMiseAJourDesign(
      req.body,
      proAutorise
    );

    const { data, error } = await supabase
      .from('restaurants')
      .update(miseAJour)
      .eq('id', acces.restaurant.id)
      .select(CHAMPS_RESTAURANT)
      .single();

    if (error) throw error;

    setImmediate(() => {
      actualiserCartesAppleEnArrierePlan(data);
      actualiserClasseGoogleEnArrierePlan(data);
    });

    res.json({
      succes: true,
      message: 'Design enregistré. Les cartes Apple existantes se mettent à jour en arrière-plan.',
      restaurant: designRestaurant.serialiserRestaurant(
        data,
        appleWallet.designProDisponible()
      )
    });
  } catch (erreur) {
    console.error(erreur);
    res.status(400).json({ erreur: erreur.message });
  }
});

// Tableau de bord unifié du restaurateur : statistiques, clients et campagnes.
app.get('/api/restaurateur/:slug/tableau-de-bord', async (req, res) => {
  try {
    const acces = await authentifierEspaceDesign(req, res, 'dashboard');
    if (!acces) return;

    const [resultatClients, tableauParrainage, tableauAntiFraude, statistiquesDetaillees] = await Promise.all([
      supabase
        .from('clients')
        .select(
          'id, nom, email, telephone, points, apple_wallet_serial, google_wallet_object_id, date_inscription'
        )
        .eq('restaurant_id', acces.restaurant.id)
        .order('date_inscription', { ascending: false }),
      referral.obtenirTableauParrainage(acces.restaurant.id),
      antiFraude.obtenirTableauAntiFraude(acces.restaurant.id),
      analytics.obtenirStatistiques(acces.restaurant.id, 30)
    ]);

    const { data: clients, error } = resultatClients;

    if (error) throw error;

    const historique = obtenirHistoriqueNotifications(acces.restaurant);
    const totalPoints = clients.reduce(
      (total, client) => total + Number(client.points || 0),
      0
    );

    res.json({
      administrateur: acces.administrateur,
      acces: {
        role: acces.role,
        permissions: acces.permissions,
        utilisateur: acces.contexte
          ? {
              id: acces.contexte.utilisateur.id,
              nom: acces.contexte.profil.full_name,
              email: acces.contexte.profil.email
            }
          : null
      },
      restaurant: designRestaurant.serialiserRestaurant(
        acces.restaurant,
        appleWallet.designProDisponible()
      ),
      statistiques: {
        clients: clients.length,
        clients_actifs: clients.filter(client => Number(client.points) > 0).length,
        points: totalPoints,
        cartes_apple: clients.filter(client => client.apple_wallet_serial).length,
        campagnes_24h: historique.filter(campagne => {
          const date = new Date(campagne.created_at).getTime();
          return Number.isFinite(date) && date > Date.now() - 24 * 60 * 60 * 1000;
        }).length
      },
      clients: clients.map(client => ({
        id: client.id,
        nom: client.nom,
        email: client.email,
        telephone: client.telephone,
        points: client.points,
        date_inscription: client.date_inscription,
        apple_wallet: Boolean(client.apple_wallet_serial),
        google_wallet: true
      })),
      notifications: historique,
      parrainage: tableauParrainage,
      anti_fraude: tableauAntiFraude,
      statistiques_detaillees: statistiquesDetaillees,
      roue: {
        lots: LOTS_ROUE.map(lot => ({ label: lot.label, icone: lot.icone }))
      },
      notification_en_cours: Boolean(acces.restaurant.notification_sending),
      limite_notifications_24h: 3
    });
  } catch (erreur) {
    console.error(erreur);
    res.status(500).json({ erreur: erreur.message });
  }
});

app.get('/api/restaurateur/:slug/statistiques', async (req, res) => {
  try {
    const acces = await authentifierEspaceDesign(req, res, 'statistics');
    if (!acces) return;

    const statistiques = await analytics.obtenirStatistiques(
      acces.restaurant.id,
      req.query.jours
    );
    res.json({ statistiques });
  } catch (erreur) {
    console.error(erreur);
    res.status(400).json({ erreur: erreur.message });
  }
});

app.post('/api/restaurateur/:slug/cartes/actualiser', async (req, res) => {
  try {
    const acces = await authentifierEspaceDesign(req, res, 'cards_sync');
    if (!acces) return;

    const [resultatClients, resultatCodes] = await Promise.all([
      supabase
        .from('clients')
        .select('*')
        .eq('restaurant_id', acces.restaurant.id),
      supabase
        .from('referral_codes')
        .select('client_id, code')
        .eq('restaurant_id', acces.restaurant.id)
    ]);

    if (resultatClients.error) throw resultatClients.error;
    if (resultatCodes.error) throw resultatCodes.error;

    const codes = new Map(
      (resultatCodes.data || []).map(entree => [entree.client_id, entree.code])
    );
    const bilan = {
      clients: resultatClients.data.length,
      google_reussies: 0,
      google_echecs: 0,
      apple_reussies: 0,
      apple_echecs: 0,
      diagnostic_google: {}
    };

    for (let index = 0; index < resultatClients.data.length; index += 5) {
      const lot = resultatClients.data.slice(index, index + 5);
      await Promise.all(lot.map(async client => {
        const codeParrainage = codes.get(client.id) || null;
        const clientWallet = {
          ...client,
          referral_code: codeParrainage,
          referral_link: referral.construireLienParrainage(
            acces.restaurant.slug,
            codeParrainage
          )
        };

        const resultatGoogle = await wallet.diagnostiquerSynchronisationObjetWallet(
          clientWallet,
          acces.restaurant
        );
        if (resultatGoogle.succes) {
          bilan.google_reussies += 1;
        } else {
          bilan.google_echecs += 1;
          const statut = resultatGoogle.erreur?.statut || 'inconnu';
          const message = resultatGoogle.erreur?.message || 'Erreur inconnue';
          const cle = `${statut} - ${message}`;
          bilan.diagnostic_google[cle] = (bilan.diagnostic_google[cle] || 0) + 1;
        }

        if (client.apple_wallet_serial) {
          try {
            await appleWallet.mettreAJourPasseApple(
              client.apple_wallet_serial,
              clientWallet,
              acces.restaurant
            );
            bilan.apple_reussies += 1;
          } catch (erreurApple) {
            bilan.apple_echecs += 1;
            console.error(
              `Actualisation Apple impossible pour ${client.id}:`,
              erreurApple.message
            );
          }
        }
      }));
    }

    res.json({ succes: true, bilan });
  } catch (erreur) {
    console.error(erreur);
    res.status(500).json({ erreur: erreur.message });
  }
});

app.put('/api/restaurateur/:slug/parrainage', async (req, res) => {
  try {
    const acces = await authentifierEspaceDesign(req, res, 'referral_manage');
    if (!acces) return;

    const reglages = await referral.enregistrerReglages(
      acces.restaurant.id,
      req.body || {}
    );

    res.json({
      succes: true,
      message: 'Le programme de parrainage a bien été enregistré.',
      reglages
    });
  } catch (erreur) {
    console.error(erreur);
    res.status(400).json({ erreur: erreur.message });
  }
});

app.put('/api/restaurateur/:slug/anti-fraude', async (req, res) => {
  try {
    const acces = await authentifierEspaceDesign(req, res, 'fraud_manage');
    if (!acces) return;

    const reglages = await antiFraude.enregistrerReglages(
      acces.restaurant.id,
      req.body || {}
    );

    res.json({
      succes: true,
      message: 'La protection anti-fraude a bien été enregistrée.',
      reglages
    });
  } catch (erreur) {
    console.error(erreur);
    res.status(400).json({ erreur: erreur.message });
  }
});

app.post('/api/restaurateur/:slug/anti-fraude/:alerteId/traiter', async (req, res) => {
  try {
    const acces = await authentifierEspaceDesign(req, res, 'fraud_review');
    if (!acces) return;

    const alerte = await antiFraude.traiterAlerte(
      acces.restaurant.id,
      req.params.alerteId,
      req.body?.statut || 'reviewed'
    );

    res.json({ succes: true, alerte });
  } catch (erreur) {
    console.error(erreur);
    res.status(400).json({ erreur: erreur.message });
  }
});

app.post('/api/restaurateur/:slug/notifications', async (req, res) => {
  try {
    const acces = await authentifierEspaceDesign(req, res, 'notifications');
    if (!acces) return;

    const notification = validerNotification(req.body);
    const identifiantRequete = String(req.body.request_id || '').trim();
    const campagneId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      identifiantRequete
    )
      ? identifiantRequete
      : crypto.randomUUID();
    const clientTestId = req.body.client_id_test
      ? String(req.body.client_id_test).trim()
      : null;
    const historique = obtenirHistoriqueNotifications(acces.restaurant);
    const campagneExistante = historique.find(
      campagne => campagne.id === campagneId
    );

    if (campagneExistante) {
      return res.status(202).json({
        succes: true,
        message: 'Cette campagne a déjà été prise en compte.',
        campagne: campagneExistante
      });
    }
    const maintenant = new Date();
    const campagnes24h = historique.filter(campagne => {
      const date = new Date(campagne.created_at).getTime();
      return (
        campagne.statut !== 'echec' &&
        Number.isFinite(date) &&
        date > Date.now() - 24 * 60 * 60 * 1000
      );
    });

    if (campagnes24h.length >= 3) {
      return res.status(429).json({
        erreur: 'La limite de 3 notifications sur 24 heures est atteinte.'
      });
    }

    const derniereDate = new Date(
      historique[0]?.created_at || acces.restaurant.last_notification_sent_at || 0
    ).getTime();
    const envoiBloque =
      acces.restaurant.notification_sending &&
      Number.isFinite(derniereDate) &&
      derniereDate > Date.now() - 15 * 60 * 1000;

    if (envoiBloque) {
      return res.status(409).json({
        erreur: 'Une campagne est déjà en cours. Attendez sa fin avant de recommencer.'
      });
    }

    const { data: clients, error: erreurClients } = await supabase
      .from('clients')
      .select('id, nom, points, scan_code, apple_wallet_serial')
      .eq('restaurant_id', acces.restaurant.id);

    if (erreurClients) throw erreurClients;

    const clientsPlateforme = clients.filter(client => {
      if (notification.plateforme === 'apple') {
        return Boolean(client.apple_wallet_serial);
      }
      return true;
    });
    const clientsEligibles = clientTestId
      ? clientsPlateforme.filter(client => client.id === clientTestId)
      : clientsPlateforme;

    if (clientsEligibles.length === 0) {
      return res.status(400).json({
        erreur: 'Aucune carte Wallet compatible ne peut recevoir ce message.'
      });
    }

    const campagne = {
      id: campagneId,
      titre: notification.titre,
      message: notification.message,
      plateforme: notification.plateforme,
      statut: 'en_cours',
      destinataires: clientsEligibles.length,
      apple_reussies: 0,
      apple_echecs: 0,
      google_reussies: 0,
      google_echecs: 0,
      created_at: maintenant.toISOString(),
      completed_at: null,
      creee_par_admin: acces.administrateur,
      test: Boolean(clientTestId)
    };
    const nouvelHistorique = [campagne, ...historique].slice(0, 50);

    const miseAJourRestaurant = {
      notification_history: nouvelHistorique,
      notification_sending: true
    };

    // Un test ne doit pas devenir le dernier message officiel du commerce,
    // sinon les autres cartes le recevraient lors d'une future mise à jour.
    if (!clientTestId) {
      miseAJourRestaurant.last_notification_title = campagne.titre;
      miseAJourRestaurant.last_notification_message = campagne.message;
      miseAJourRestaurant.last_notification_sent_at = campagne.created_at;
    }

    const { data: restaurantMisAJour, error: erreurMiseAJour } = await supabase
      .from('restaurants')
      .update(miseAJourRestaurant)
      .eq('id', acces.restaurant.id)
      .select(CHAMPS_RESTAURANT)
      .single();

    if (erreurMiseAJour) throw erreurMiseAJour;

    // La réponse part immédiatement. Le serveur poursuit les envois par lots
    // et l'interface actualise ensuite l'historique automatiquement.
    const restaurantPourEnvoi = {
      ...restaurantMisAJour,
      // Wallet affiche organizationName comme titre de notification. Cette
      // valeur n'est pas enregistrée en base : elle ne sert qu'à cet envoi.
      notification_title_override: campagne.titre,
      ...(clientTestId
        ? {
            last_notification_title: campagne.titre,
            last_notification_message: campagne.message,
            last_notification_sent_at: campagne.created_at
          }
        : {})
    };

    void traiterCampagneWallet(
      campagne,
      clientsEligibles,
      restaurantPourEnvoi
    );

    res.status(202).json({
      succes: true,
      message: 'La campagne Wallet est en cours d’envoi.',
      campagne
    });
  } catch (erreur) {
    console.error(erreur);
    res.status(400).json({ erreur: erreur.message });
  }
});

// Console Bravocard. Seul l'administrateur principal peut gérer les commerces.
app.get('/api/restaurateur/:slug/equipe', async (req, res) => {
  try {
    const acces = await authentifierEspaceDesign(req, res, 'team_manage');
    if (!acces) return;
    const membres = await auth.listerEquipe(acces.restaurant.id);
    res.json({
      membres,
      roles: auth.ROLES,
      peut_nommer_proprietaire: acces.administrateur
    });
  } catch (erreur) {
    console.error(erreur);
    res.status(400).json({ erreur: erreur.message });
  }
});

app.post('/api/restaurateur/:slug/equipe', async (req, res) => {
  try {
    const acces = await authentifierEspaceDesign(req, res, 'team_manage');
    if (!acces) return;
    const role = String(req.body.role || 'employee');
    if (role === 'owner' && !acces.administrateur) {
      return res.status(403).json({
        erreur: 'Seul le super-administrateur peut nommer un propriétaire.'
      });
    }
    const resultat = await auth.creerOuAssocierUtilisateur({
      email: req.body.email,
      fullName: req.body.nom,
      restaurantId: acces.restaurant.id,
      role,
      invitedBy: acces.contexte?.utilisateur?.id || null
    });
    const activation = await envoyerActivationCompte(req, resultat);
    await auth.journaliser(
      'team.member_added',
      acces.contexte,
      acces.restaurant.id,
      { user_id: resultat.profil.user_id, role }
    );
    res.status(201).json({
      succes: true,
      membre: {
        ...resultat.appartenance,
        email: resultat.profil.email,
        full_name: resultat.profil.full_name
      },
      nouveau_compte: resultat.nouveau_compte,
      email_activation_envoye: activation.email_envoye,
      mot_de_passe_temporaire: activation.email_envoye
        ? null
        : resultat.mot_de_passe_temporaire
    });
  } catch (erreur) {
    console.error(erreur);
    const conflit = erreur.code === '23505';
    res.status(conflit ? 409 : 400).json({ erreur: erreur.message });
  }
});

app.patch('/api/restaurateur/:slug/equipe/:membershipId', async (req, res) => {
  try {
    const acces = await authentifierEspaceDesign(req, res, 'team_manage');
    if (!acces) return;
    if (req.body.role === 'owner' && !acces.administrateur) {
      return res.status(403).json({
        erreur: 'Seul le super-administrateur peut nommer un propriétaire.'
      });
    }
    // A restaurant owner may manage their team, but cannot demote or suspend
    // another owner; that remains a Bravocard super-admin action.
    if (!acces.administrateur) {
      const membres = await auth.listerEquipe(acces.restaurant.id);
      const cible = membres.find(membre => membre.id === req.params.membershipId);
      if (cible?.role === 'owner') {
        return res.status(403).json({
          erreur: 'Seul le super-administrateur peut modifier un propriétaire.'
        });
      }
    }
    const appartenance = await auth.modifierAppartenance(
      acces.restaurant.id,
      req.params.membershipId,
      {
        ...(typeof req.body.role === 'string' ? { role: req.body.role } : {}),
        ...(typeof req.body.active === 'boolean' ? { active: req.body.active } : {})
      }
    );
    await auth.journaliser(
      'team.member_updated',
      acces.contexte,
      acces.restaurant.id,
      { membership_id: appartenance.id, role: appartenance.role, active: appartenance.active }
    );
    res.json({ succes: true, appartenance });
  } catch (erreur) {
    console.error(erreur);
    res.status(400).json({ erreur: erreur.message });
  }
});

app.get('/api/admin/restaurants', exigerAdministrateur, async (req, res) => {
  try {
    const [resultatRestaurants, resultatAppartenances] = await Promise.all([
      supabase
        .from('restaurants')
        .select(CHAMPS_RESTAURANT)
        .order('nom', { ascending: true }),
      supabase
        .from('restaurant_memberships')
        .select('restaurant_id, user_id, role, active')
        .eq('active', true)
    ]);

    if (resultatRestaurants.error) throw resultatRestaurants.error;
    if (resultatAppartenances.error) throw resultatAppartenances.error;
    const appartenances = resultatAppartenances.data || [];
    const idsProprietaires = appartenances
      .filter(entree => entree.role === 'owner')
      .map(entree => entree.user_id);
    let profils = [];
    if (idsProprietaires.length) {
      const resultatProfils = await supabase
        .from('user_profiles')
        .select('user_id, email, full_name, subscription_plan, stripe_subscription_status, stripe_price_id, stripe_customer_id, stripe_subscription_id, subscription_current_period_end, subscription_updated_at')
        .in('user_id', idsProprietaires);
      if (resultatProfils.error) throw resultatProfils.error;
      profils = resultatProfils.data || [];
    }
    const profilsParId = new Map(profils.map(profil => [profil.user_id, profil]));
    res.json({
      restaurants: resultatRestaurants.data.map(restaurant => {
        const equipe = appartenances.filter(entree => entree.restaurant_id === restaurant.id);
        return {
          ...designRestaurant.serialiserRestaurant(
          restaurant,
          appleWallet.designProDisponible()
          ),
          membres_actifs: equipe.length,
          proprietaires: equipe
            .filter(entree => entree.role === 'owner')
            .map(entree => profilsParId.get(entree.user_id))
            .filter(Boolean)
        };
      })
    });
  } catch (erreur) {
    console.error(erreur);
    res.status(500).json({ erreur: erreur.message });
  }
});

app.get('/api/admin/demandes-demo', exigerAdministrateur, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('demo_requests')
      .select('id, full_name, phone, email, status, source, notes, created_at, contacted_at')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    res.json({ demandes: data || [] });
  } catch (erreur) {
    console.error(erreur);
    res.status(500).json({ erreur: erreur.message });
  }
});

app.patch('/api/admin/demandes-demo/:id', exigerAdministrateur, async (req, res) => {
  try {
    const statut = String(req.body.status || '').trim();
    if (!['new', 'contacted', 'qualified', 'closed'].includes(statut)) {
      return res.status(400).json({ erreur: 'Le statut demandé est invalide.' });
    }
    const miseAJour = {
      status: statut,
      notes: typeof req.body.notes === 'string'
        ? req.body.notes.trim().slice(0, 1000) || null
        : undefined,
      contacted_at: statut === 'new' ? null : new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    if (miseAJour.notes === undefined) delete miseAJour.notes;
    const { data, error } = await supabase
      .from('demo_requests')
      .update(miseAJour)
      .eq('id', req.params.id)
      .select('id, full_name, phone, email, status, notes, created_at, contacted_at')
      .single();
    if (error) throw error;
    res.json({ demande: data });
  } catch (erreur) {
    console.error(erreur);
    res.status(400).json({ erreur: erreur.message });
  }
});

app.post('/api/admin/restaurants', exigerAdministrateur, async (req, res) => {
  try {
    const nom = designRestaurant.nettoyerTexte(req.body.nom, 80, 'Le nom du commerce');
    const slug = designRestaurant.normaliserSlug(req.body.slug || nom);
    const codeAcces = designRestaurant.genererCodeAcces();

    const { data, error } = await supabase
      .from('restaurants')
      .insert({
        nom,
        slug,
        design_access_token_hash: designRestaurant.hacherCodeAcces(codeAcces),
        apple_pro_design: true
      })
      .select(CHAMPS_RESTAURANT)
      .single();

    if (error) throw error;

    setImmediate(() => actualiserClasseGoogleEnArrierePlan(data));

    res.status(201).json({
      restaurant: designRestaurant.serialiserRestaurant(
        data,
        appleWallet.designProDisponible()
      ),
      code_acces: codeAcces
    });
  } catch (erreur) {
    console.error(erreur);
    const conflit = erreur.code === '23505';
    res.status(conflit ? 409 : 400).json({
      erreur: conflit ? 'Ce lien de commerce existe déjà.' : erreur.message
    });
  }
});

app.post('/api/admin/restaurants/:id/proprietaires', exigerAdministrateur, async (req, res) => {
  try {
    const { data: restaurant, error } = await supabase
      .from('restaurants')
      .select('id, nom, slug')
      .eq('id', req.params.id)
      .single();
    if (error) throw error;
    const resultat = await auth.creerOuAssocierUtilisateur({
      email: req.body.email,
      fullName: req.body.nom,
      restaurantId: restaurant.id,
      role: 'owner',
      invitedBy: req.bravocardAdmin?.utilisateur?.id || null
    });
    const activation = await envoyerActivationCompte(req, resultat);
    await auth.journaliser(
      'admin.owner_assigned',
      req.bravocardAdmin?.utilisateur ? req.bravocardAdmin : null,
      restaurant.id,
      { user_id: resultat.profil.user_id }
    );
    res.status(201).json({
      succes: true,
      restaurant,
      compte: resultat.profil,
      nouveau_compte: resultat.nouveau_compte,
      email_activation_envoye: activation.email_envoye,
      mot_de_passe_temporaire: activation.email_envoye
        ? null
        : resultat.mot_de_passe_temporaire
    });
  } catch (erreur) {
    console.error(erreur);
    res.status(400).json({ erreur: erreur.message });
  }
});

app.patch('/api/admin/restaurants/:id', exigerAdministrateur, async (req, res) => {
  try {
    const miseAJour = {};

    if (typeof req.body.nom === 'string') {
      miseAJour.nom = designRestaurant.nettoyerTexte(
        req.body.nom,
        80,
        'Le nom du commerce'
      );
    }

    for (const champ of ['actif', 'design_enabled', 'apple_pro_design']) {
      if (typeof req.body[champ] === 'boolean') {
        miseAJour[champ] = req.body[champ];
      }
    }

    if (Object.keys(miseAJour).length === 0) {
      return res.status(400).json({ erreur: 'Aucune modification valide.' });
    }

    const { data, error } = await supabase
      .from('restaurants')
      .update(miseAJour)
      .eq('id', req.params.id)
      .select(CHAMPS_RESTAURANT)
      .single();

    if (error) throw error;
    res.json({
      restaurant: designRestaurant.serialiserRestaurant(
        data,
        appleWallet.designProDisponible()
      )
    });
  } catch (erreur) {
    console.error(erreur);
    res.status(400).json({ erreur: erreur.message });
  }
});

app.delete('/api/admin/restaurants/:id', exigerAdministrateur, async (req, res) => {
  try {
    const { data: restaurant, error: erreurLecture } = await supabase
      .from('restaurants')
      .select(CHAMPS_RESTAURANT)
      .eq('id', req.params.id)
      .single();
    if (erreurLecture) throw erreurLecture;
    if (restaurant.deleted_at) {
      return res.json({ succes: true, restaurant, message: 'Ce restaurant est déjà dans la corbeille.' });
    }
    const raison = String(req.body?.raison || '').trim().slice(0, 500) || null;
    const maintenant = new Date().toISOString();
    const { data, error } = await supabase
      .from('restaurants')
      .update({
        deleted_at: maintenant,
        deleted_by: req.bravocardAdmin?.utilisateur?.id || null,
        deletion_reason: raison,
        active_before_delete: restaurant.actif !== false,
        actif: false
      })
      .eq('id', restaurant.id)
      .select(CHAMPS_RESTAURANT)
      .single();
    if (error) throw error;
    await auth.journaliser(
      'admin.restaurant_trashed',
      req.bravocardAdmin?.utilisateur ? req.bravocardAdmin : null,
      restaurant.id,
      { raison }
    );
    res.json({ succes: true, restaurant: data, message: 'Restaurant placé dans la corbeille.' });
  } catch (erreur) {
    console.error(erreur);
    res.status(400).json({ erreur: erreur.message });
  }
});

app.post('/api/admin/restaurants/:id/restaurer', exigerAdministrateur, async (req, res) => {
  try {
    const { data: restaurant, error: erreurLecture } = await supabase
      .from('restaurants')
      .select(CHAMPS_RESTAURANT)
      .eq('id', req.params.id)
      .single();
    if (erreurLecture) throw erreurLecture;
    if (!restaurant.deleted_at) {
      return res.json({ succes: true, restaurant, message: 'Ce restaurant est déjà actif.' });
    }
    const { data, error } = await supabase
      .from('restaurants')
      .update({
        deleted_at: null,
        deleted_by: null,
        deletion_reason: null,
        restored_at: new Date().toISOString(),
        actif: restaurant.active_before_delete !== false,
        active_before_delete: null
      })
      .eq('id', restaurant.id)
      .select(CHAMPS_RESTAURANT)
      .single();
    if (error) throw error;
    await auth.journaliser(
      'admin.restaurant_restored',
      req.bravocardAdmin?.utilisateur ? req.bravocardAdmin : null,
      restaurant.id,
      {}
    );
    res.json({ succes: true, restaurant: data, message: 'Restaurant restauré avec toutes ses données.' });
  } catch (erreur) {
    console.error(erreur);
    res.status(400).json({ erreur: erreur.message });
  }
});

app.post(
  '/api/admin/restaurants/:id/reset-access',
  exigerAdministrateur,
  async (req, res) => {
    try {
      const codeAcces = designRestaurant.genererCodeAcces();
      const { data, error } = await supabase
        .from('restaurants')
        .update({
          design_access_token_hash: designRestaurant.hacherCodeAcces(codeAcces)
        })
        .eq('id', req.params.id)
        .select('id, nom, slug')
        .single();

      if (error) throw error;
      res.json({ restaurant: data, code_acces: codeAcces });
    } catch (erreur) {
      console.error(erreur);
      res.status(400).json({ erreur: erreur.message });
    }
  }
);

// Route a usage unique : configure la disposition personnalisee de la carte
// Google Wallet (lignes Client / Carte). Protegee par le meme mot de passe
// que le tableau de bord, pour eviter qu'elle soit appelee par n'importe qui.
app.post('/api/admin/configurer-template', exigerAdministrateur, async (req, res) => {
  try {
    const { data: restaurant, error } = await supabase
      .from('restaurants')
      .select(CHAMPS_RESTAURANT)
      .eq('id', req.body.restaurant_id)
      .is('deleted_at', null)
      .single();
    if (error) throw error;
    await wallet.configurerModeleCarte(restaurant);
    res.json({ succes: true, message: 'Modèle Google Wallet du restaurant configuré.' });
  } catch (erreur) {
    console.error(erreur);
    res.status(500).json({ erreur: erreur.message });
  }
});

// Route de test pour verifier que le serveur tourne bien
app.get('/api/statut', (req, res) => {
  res.send('Le serveur de la carte de fidelite fonctionne.');
});

// Recupere la liste de tous les clients, pour le tableau de bord restaurateur
// Protege par un mot de passe simple (passe en en-tete)
app.get('/api/clients', exigerAdministrateur, async (req, res) => {
  try {
    const { data: clients, error } = await supabase
      .from('clients')
      .select('nom, email, telephone, points, date_inscription')
      .order('points', { ascending: false });

    if (error) throw error;

    res.json({ clients });
  } catch (erreur) {
    console.error(erreur);
    res.status(500).json({ erreur: erreur.message });
  }
});

// Crée un nouveau client, son parrainage éventuel et ses cartes Wallet.
app.post('/api/clients', async (req, res) => {
  try {
    const {
      nom,
      email: emailClient,
      telephone,
      restaurant_slug: slugRecu,
      code_parrainage: codeParrainage
    } = req.body;
    const nomNettoye = String(nom || '').trim();
    const emailNettoye = String(emailClient || '').trim().toLowerCase();
    const telephoneNettoye = String(telephone || '').trim();

    if (!nomNettoye || nomNettoye.length > 80) {
      return res.status(400).json({ erreur: 'Le prénom est obligatoire.' });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNettoye)) {
      return res.status(400).json({ erreur: 'L’adresse email est invalide.' });
    }

    const slugRestaurant =
      slugRecu || process.env.DEFAULT_RESTAURANT_SLUG || 'chez-basile';
    const restaurant = await trouverRestaurantParSlug(slugRestaurant);

    if (!restaurant || restaurant.actif === false) {
      return res.status(404).json({ erreur: 'Ce commerce est introuvable.' });
    }
    if (!auth.accesFacturationRestaurant(restaurant)) {
      return res.status(402).json({
        erreur: 'Le programme de fidélité de ce commerce est temporairement indisponible.',
        code: 'SUBSCRIPTION_REQUIRED'
      });
    }

    const { data: clientExistant, error: erreurDoublon } = await supabase
      .from('clients')
      .select('id')
      .eq('restaurant_id', restaurant.id)
      .ilike('email', emailNettoye)
      .maybeSingle();

    if (erreurDoublon) throw erreurDoublon;
    if (clientExistant) {
      return res.status(409).json({
        erreur: 'Une carte existe déjà avec cette adresse email dans ce commerce.'
      });
    }

    const invitation = codeParrainage
      ? await referral.obtenirInvitation(restaurant.id, codeParrainage)
      : null;
    referral.verifierIdentiteDistincte(invitation, {
      email: emailNettoye,
      telephone: telephoneNettoye
    });

    const { data: nouveauClient, error } = await supabase
      .from('clients')
      .insert([{
        nom: nomNettoye,
        email: emailNettoye,
        telephone: telephoneNettoye || null,
        points: 0,
        restaurant_id: restaurant.id
      }])
      .select()
      .single();

    if (error) throw error;

    let codePersonnel;
    try {
      codePersonnel = await referral.assurerCodeClient(
        nouveauClient.id,
        restaurant.id
      );
      await referral.enregistrerInvitation(
        restaurant.id,
        nouveauClient.id,
        invitation
      );
    } catch (erreurParrainage) {
      if (referral.estErreurPermission(erreurParrainage) && !invitation) {
        codePersonnel = null;
        console.warn(
          'Parrainage désactivé : configurez une clé Supabase service_role sur le backend.'
        );
      } else {
        await supabase.from('clients').delete().eq('id', nouveauClient.id);
        throw erreurParrainage;
      }
    }

    const lienParrainage = referral.construireLienParrainage(
      restaurant.slug,
      codePersonnel
    );
    const clientWallet = {
      ...nouveauClient,
      referral_code: codePersonnel,
      referral_link: lienParrainage
    };

    // On cree l'objet cote Google, puis on genere le lien a envoyer au client
    await wallet.creerObjetWallet(clientWallet, restaurant);
    const lienWallet = wallet.creerLienGoogleWallet(clientWallet, restaurant);

    // On cree aussi la carte Apple Wallet, et on garde son serialNumber
    // pour pouvoir la mettre a jour plus tard (scan, points, etc.)
    let lienAppleWallet = null;
    try {
      const passeApple = await appleWallet.creerPasseApple(
        clientWallet,
        restaurant
      );
      lienAppleWallet = passeApple.shareUrl;
      await supabase
        .from('clients')
        .update({ apple_wallet_serial: passeApple.serialNumber })
        .eq('id', nouveauClient.id);
    } catch (erreurApple) {
      console.error('Erreur creation Apple Wallet:', erreurApple.message);
    }

    await email.envoyerEmailBienvenue(
      emailNettoye,
      nomNettoye,
      lienWallet,
      lienAppleWallet
    );

    res.json({
      client: {
        ...nouveauClient,
        code_parrainage: codePersonnel,
        lien_parrainage: lienParrainage
      },
      restaurant: { nom: restaurant.nom, slug: restaurant.slug },
      lienWallet,
      lienAppleWallet,
      parrainage: invitation
        ? {
            statut: 'en_attente_premier_scan',
            points_filleul: invitation.referee_points
          }
        : null
    });
  } catch (erreur) {
    console.error(erreur);
    res.status(500).json({ erreur: erreur.message });
  }
});

// Enregistrer un scan depuis l'espace sécurisé du restaurateur.
app.post('/api/restaurateur/:slug/scan', async (req, res) => {
  try {
    const acces = await authentifierEspaceDesign(req, res, 'scan');
    if (!acces) return;

    const codeScanne = String(req.body.client_id || '').trim();
    const pointsAAjouter = Number.parseInt(acces.restaurant.points_per_scan || 10, 10);

    if (!Number.isInteger(pointsAAjouter) || pointsAAjouter < 1 || pointsAAjouter > 100) {
      return res.status(400).json({
        erreur: 'Le nombre de points doit être compris entre 1 et 100.'
      });
    }

    const codeEstUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      codeScanne
    );
    const codeEstCourt = /^BC[A-F0-9]{10}$/i.test(codeScanne);
    if (!codeEstUuid && !codeEstCourt) {
      return res.status(400).json({
        erreur: 'Ce code-barres n’est pas reconnu. Cadrez entièrement les barres dans la caméra.'
      });
    }
    const requeteClient = supabase
      .from('clients')
      .select('*, restaurants(*)');
    const { data: client, error: erreurLecture } = codeEstUuid
      ? await requeteClient.eq('id', codeScanne).single()
      : await requeteClient.eq('scan_code', codeScanne.toUpperCase()).single();

    if (erreurLecture) throw erreurLecture;

    if (client.restaurant_id !== acces.restaurant.id) {
      return res.status(404).json({
        erreur: 'Cette carte n’appartient pas à votre établissement.'
      });
    }

    const controleScan = await antiFraude.enregistrerScan(
      acces.restaurant.id,
      client.id,
      pointsAAjouter
    );

    if (!controleScan.autorise) {
      return res.status(409).json({
        erreur: controleScan.message,
        anti_fraude: {
          bloque: true,
          motif: controleScan.motif,
          prochaine_autorisation: controleScan.prochaine_autorisation
        }
      });
    }

    const scan = { id: controleScan.scan_id };

    let parrainageValide = null;
    try {
      parrainageValide = await referral.validerAuPremierScan(client.id, scan.id);
    } catch (erreurParrainage) {
      if (!referral.estErreurPermission(erreurParrainage)) {
        throw erreurParrainage;
      }
    }

    const { data: clientActualise, error: erreurSolde } = await supabase
      .from('clients')
      .select('points')
      .eq('id', client.id)
      .single();

    if (erreurSolde) throw erreurSolde;

    // Verifie si le client vient d'atteindre le seuil de recompense
    const restaurant = client.restaurants || null;
    const seuil = Number.parseInt(
      restaurant?.seuil_recompense || process.env.SEUIL_RECOMPENSE || '100',
      10
    );
    let recompenseAtteinte = false;
    let soldeFinal = Number(clientActualise.points || 0);

    if (soldeFinal >= seuil) {
      recompenseAtteinte = true;
      soldeFinal = 0; // On remet le compteur a zero apres la recompense

      await supabase
        .from('clients')
        .update({ points: soldeFinal })
        .eq('id', client.id);

      try {
        await email.envoyerEmailRecompense(client.email, client.nom);
      } catch (erreurEmail) {
        console.error('Erreur envoi email recompense:', erreurEmail.message);
      }
    }

    // On met a jour la carte Google Wallet en temps reel
    let codeClient = null;
    try {
      codeClient = await referral.assurerCodeClient(client.id, restaurant.id);
    } catch (erreurParrainage) {
      if (!referral.estErreurPermission(erreurParrainage)) {
        throw erreurParrainage;
      }
    }
    const clientPourWallet = {
      ...client,
      points: soldeFinal,
      referral_code: codeClient,
      referral_link: referral.construireLienParrainage(
        restaurant.slug,
        codeClient
      )
    };

    await wallet.synchroniserObjetWallet(clientPourWallet, restaurant);

    // On met aussi a jour la carte Apple Wallet, si le client en a une
    if (client.apple_wallet_serial) {
      try {
        await appleWallet.mettreAJourPasseApple(
          client.apple_wallet_serial,
          clientPourWallet,
          restaurant
        );
      } catch (erreurApple) {
        console.error('Erreur mise a jour Apple Wallet:', erreurApple.message);
      }
    }

    if (parrainageValide?.sponsor_client_id) {
      const { data: parrain, error: erreurParrain } = await supabase
        .from('clients')
        .select('*')
        .eq('id', parrainageValide.sponsor_client_id)
        .single();

      if (erreurParrain) throw erreurParrain;

      const codeParrain = await referral.assurerCodeClient(
        parrain.id,
        restaurant.id
      );
      const parrainPourWallet = {
        ...parrain,
        points: parrainageValide.sponsor_balance,
        referral_code: codeParrain,
        referral_link: referral.construireLienParrainage(
          restaurant.slug,
          codeParrain
        )
      };

      await wallet.mettreAJourPointsWallet(parrainPourWallet, restaurant);

      if (parrain.apple_wallet_serial) {
        try {
          await appleWallet.mettreAJourPasseApple(
            parrain.apple_wallet_serial,
            parrainPourWallet,
            restaurant
          );
        } catch (erreurApple) {
          console.error(
            'Erreur mise à jour Apple Wallet du parrain:',
            erreurApple.message
          );
        }
      }
    }

    res.json({
      succes: true,
      client_nom: client.nom,
      nouveauSolde: soldeFinal,
      points_ajoutes: pointsAAjouter,
      recompenseAtteinte,
      parrainage_valide: Boolean(parrainageValide),
      bonus_filleul: Number(parrainageValide?.referee_points_awarded || 0),
      bonus_parrain: Number(parrainageValide?.sponsor_points_awarded || 0),
      anti_fraude: { protege: true }
    });
  } catch (erreur) {
    console.error(erreur);
    res.status(500).json({ erreur: erreur.message });
  }
});

// Liste des lots possibles, avec leur probabilite (doit totaliser 100).
const LOTS_ROUE = [
  { label: 'Menu offert', icone: '🍽️', probabilite: 5 },
  { label: '-10% addition', icone: '🏷️', probabilite: 20 },
  { label: 'Dessert offert', icone: '🍰', probabilite: 10 },
  { label: 'Boisson offerte', icone: '🥤', probabilite: 30 },
  { label: 'Rejouez', icone: '🔁', probabilite: 15 },
  { label: 'Perdu !', icone: '🙈', probabilite: 20 }
];

// Nombre de jours avant que la boisson offerte devienne utilisable,
// et pendant combien de jours elle reste valable une fois debloquee
const DELAI_AVANT_BOISSON_JOURS = 1;
const DUREE_VALIDITE_BOISSON_JOURS = 7;

function tirerUnLot() {
  const total = LOTS_ROUE.reduce((somme, lot) => somme + lot.probabilite, 0);
  let tirage = Math.random() * total;
  for (let index = 0; index < LOTS_ROUE.length; index += 1) {
    tirage -= LOTS_ROUE[index].probabilite;
    if (tirage < 0) {
      const lot = LOTS_ROUE[index];
      return { index, label: lot.label, icone: lot.icone };
    }
  }
  const dernierIndex = LOTS_ROUE.length - 1;
  const dernierLot = LOTS_ROUE[dernierIndex];
  return { index: dernierIndex, label: dernierLot.label, icone: dernierLot.icone };
}

function calculerValiditeCadeau() {
  const maintenant = new Date();

  const dateDebut = new Date(maintenant);
  dateDebut.setDate(dateDebut.getDate() + DELAI_AVANT_BOISSON_JOURS);
  dateDebut.setHours(0, 0, 0, 0);

  const dateFin = new Date(dateDebut);
  dateFin.setDate(dateFin.getDate() + DUREE_VALIDITE_BOISSON_JOURS);
  dateFin.setHours(23, 59, 59, 0);

  return { dateDebut, dateFin };
}

// Verifie si un scan donne peut encore jouer a la roue
app.get('/api/roue/:scanId', async (req, res) => {
  try {
    const { data: scan, error } = await supabase
      .from('scans')
      .select('id, roue_utilisee, cadeau_gagne, cadeau_valide_du, cadeau_valide_au')
      .eq('id', req.params.scanId)
      .single();

    if (error || !scan) {
      return res.status(404).json({ erreur: 'Lien invalide ou expiré' });
    }

    res.json({
      peutJouer: !scan.roue_utilisee,
      cadeauDejaGagne: scan.cadeau_gagne || null,
      valideDu: scan.cadeau_valide_du || null,
      valideAu: scan.cadeau_valide_au || null,
      lots: LOTS_ROUE.map(l => ({ label: l.label, icone: l.icone }))
    });
  } catch (erreur) {
    res.status(500).json({ erreur: erreur.message });
  }
});

// Fait tourner la roue pour un scan donne, une seule fois possible
app.post('/api/roue/:scanId/jouer', async (req, res) => {
  try {
    const { data: scan, error: erreurLecture } = await supabase
      .from('scans')
      .select('id, roue_utilisee, client_id, clients(nom, email)')
      .eq('id', req.params.scanId)
      .single();

    if (erreurLecture || !scan) {
      return res.status(404).json({ erreur: 'Lien invalide ou expiré' });
    }

    if (scan.roue_utilisee) {
      return res.status(400).json({ erreur: 'Vous avez déjà joué avec ce lien' });
    }

    const lot = tirerUnLot();
    const { dateDebut, dateFin } = calculerValiditeCadeau();

    await supabase
      .from('scans')
      .update({
        roue_utilisee: true,
        cadeau_gagne: lot.label,
        cadeau_valide_du: dateDebut.toISOString(),
        cadeau_valide_au: dateFin.toISOString()
      })
      .eq('id', req.params.scanId);

    // Envoie un email de confirmation avec le lien a presenter au comptoir
    try {
      const lienCadeau = `${process.env.URL_SITE}/cadeau.html?scan=${req.params.scanId}`;
      await email.envoyerEmailCadeau(
        scan.clients.email,
        scan.clients.nom,
        lot.label,
        lot.icone,
        dateDebut.toISOString(),
        dateFin.toISOString(),
        lienCadeau
      );
    } catch (erreurEmail) {
      console.error('Erreur envoi email cadeau:', erreurEmail.message);
    }

    res.json({
      indexLot: lot.index,
      label: lot.label,
      icone: lot.icone,
      valideDu: dateDebut.toISOString(),
      valideAu: dateFin.toISOString()
    });
  } catch (erreur) {
    res.status(500).json({ erreur: erreur.message });
  }
});

// Verifie toutes les 15 minutes les scans a traiter pour l'envoi d'avis Google
cron.schedule('*/15 * * * *', async () => {
  console.log('Verification des scans pour envoi d\'avis...');

  const { data: scans, error } = await supabase
    .from('scans')
    .select('*, clients(nom, email)')
    .eq('avis_envoye', false);

  if (error) {
    console.error('Erreur lecture scans:', error.message);
    return;
  }

  const maintenant = new Date();

  for (const scan of scans) {
    const dateScan = new Date(scan.date_scan);
    const minutesEcoulees = (maintenant - dateScan) / (1000 * 60);

    if (minutesEcoulees >= 55 && minutesEcoulees <= 75) {
      try {
        const lienRoue = `${process.env.URL_SITE}/roue.html?scan=${scan.id}`;
        await email.envoyerEmailAvis(scan.clients.email, scan.clients.nom, lienRoue);
        await supabase.from('scans').update({ avis_envoye: true }).eq('id', scan.id);
        console.log(`Avis envoye a ${scan.clients.email}`);
      } catch (erreurEnvoi) {
        console.error('Erreur envoi avis:', erreurEnvoi.message);
      }
    }
  }
});

async function initialiserGoogleWalletMultiRestaurants() {
  if (!process.env.GOOGLE_ISSUER_ID || !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    console.warn('Migration Google Wallet ignorée : configuration Google incomplète.');
    return;
  }
  try {
    const { data: restaurants, error } = await supabase
      .from('restaurants')
      .select(CHAMPS_RESTAURANT)
      .is('deleted_at', null)
      .order('nom');
    if (error) throw error;

    for (const restaurant of restaurants || []) {
      try {
        await wallet.assurerClasseRestaurant(restaurant);
        const { data: clients, error: erreurClients } = await supabase
          .from('clients')
          .select('*')
          .eq('restaurant_id', restaurant.id);
        if (erreurClients) throw erreurClients;
        for (let index = 0; index < (clients || []).length; index += 5) {
          const lot = clients.slice(index, index + 5);
          await Promise.allSettled(lot.map(client =>
            wallet.diagnostiquerSynchronisationObjetWallet(client, restaurant)
          ));
        }
        console.log(`Google Wallet isolé pour ${restaurant.slug} (${(clients || []).length} client(s)).`);
      } catch (erreurRestaurant) {
        console.error(`Migration Google Wallet impossible pour ${restaurant.slug}:`, erreurRestaurant.message);
      }
    }
  } catch (erreur) {
    console.error('Initialisation Google Wallet multi-restaurants:', erreur.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serveur demarre sur le port ${PORT}`);
  setImmediate(initialiserGoogleWalletMultiRestaurants);
});
