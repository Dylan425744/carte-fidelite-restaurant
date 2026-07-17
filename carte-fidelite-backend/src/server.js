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

const app = express();
app.use(cors());
app.use(express.json({ limit: '3mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const CHAMPS_RESTAURANT = [
  'id',
  'nom',
  'slug',
  'seuil_recompense',
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
  'design_updated_at',
  'last_notification_title',
  'last_notification_message',
  'last_notification_sent_at',
  'notification_history',
  'notification_sending'
].join(', ');

function estAdministrateur(req) {
  const motDePasse = req.headers['x-dashboard-password'];
  return Boolean(
    process.env.DASHBOARD_PASSWORD &&
    motDePasse === process.env.DASHBOARD_PASSWORD
  );
}

function exigerAdministrateur(req, res, next) {
  if (!estAdministrateur(req)) {
    return res.status(401).json({ erreur: 'Mot de passe administrateur incorrect.' });
  }

  next();
}

async function trouverRestaurantParSlug(slug) {
  const slugNormalise = designRestaurant.normaliserSlug(slug);
  const { data, error } = await supabase
    .from('restaurants')
    .select(CHAMPS_RESTAURANT)
    .eq('slug', slugNormalise)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function authentifierEspaceDesign(req, res) {
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

  if (estAdministrateur(req)) {
    return { restaurant, administrateur: true };
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

  return { restaurant, administrateur: false };
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

// Espace commerçant. Le code privé reste dans l'en-tête et n'est jamais renvoyé.
app.get('/api/design/:slug', async (req, res) => {
  try {
    const acces = await authentifierEspaceDesign(req, res);
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

app.put('/api/design/:slug', async (req, res) => {
  try {
    const acces = await authentifierEspaceDesign(req, res);
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

    res.json({
      succes: true,
      message: 'Le design Apple Wallet a bien été enregistré.',
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
    const acces = await authentifierEspaceDesign(req, res);
    if (!acces) return;

    const { data: clients, error } = await supabase
      .from('clients')
      .select(
        'id, nom, email, telephone, points, apple_wallet_serial, google_wallet_object_id, date_inscription'
      )
      .eq('restaurant_id', acces.restaurant.id)
      .order('date_inscription', { ascending: false });

    if (error) throw error;

    const historique = obtenirHistoriqueNotifications(acces.restaurant);
    const totalPoints = clients.reduce(
      (total, client) => total + Number(client.points || 0),
      0
    );

    res.json({
      administrateur: acces.administrateur,
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
      notification_en_cours: Boolean(acces.restaurant.notification_sending),
      limite_notifications_24h: 3
    });
  } catch (erreur) {
    console.error(erreur);
    res.status(500).json({ erreur: erreur.message });
  }
});

app.post('/api/restaurateur/:slug/notifications', async (req, res) => {
  try {
    const acces = await authentifierEspaceDesign(req, res);
    if (!acces) return;

    const notification = validerNotification(req.body);
    const clientTestId = req.body.client_id_test
      ? String(req.body.client_id_test).trim()
      : null;
    const historique = obtenirHistoriqueNotifications(acces.restaurant);
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
      .select('id, nom, points, apple_wallet_serial')
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
      id: crypto.randomUUID(),
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
    const restaurantPourEnvoi = clientTestId
      ? {
          ...restaurantMisAJour,
          last_notification_title: campagne.titre,
          last_notification_message: campagne.message,
          last_notification_sent_at: campagne.created_at
        }
      : restaurantMisAJour;

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
app.get('/api/admin/restaurants', exigerAdministrateur, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('restaurants')
      .select(CHAMPS_RESTAURANT)
      .order('nom', { ascending: true });

    if (error) throw error;
    res.json({
      restaurants: data.map(restaurant =>
        designRestaurant.serialiserRestaurant(
          restaurant,
          appleWallet.designProDisponible()
        )
      )
    });
  } catch (erreur) {
    console.error(erreur);
    res.status(500).json({ erreur: erreur.message });
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
        design_access_token_hash: designRestaurant.hacherCodeAcces(codeAcces)
      })
      .select(CHAMPS_RESTAURANT)
      .single();

    if (error) throw error;

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
    await wallet.configurerModeleCarte();
    res.json({ succes: true, message: 'Modele de carte configure avec succes.' });
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

// Creer un nouveau client + sa carte Google Wallet
app.post('/api/clients', async (req, res) => {
  try {
    const {
      nom,
      email: emailClient,
      telephone,
      restaurant_slug: slugRecu
    } = req.body;
    const slugRestaurant =
      slugRecu || process.env.DEFAULT_RESTAURANT_SLUG || 'chez-basile';
    const restaurant = await trouverRestaurantParSlug(slugRestaurant);

    if (!restaurant || restaurant.actif === false) {
      return res.status(404).json({ erreur: 'Ce commerce est introuvable.' });
    }

    const { data: nouveauClient, error } = await supabase
      .from('clients')
      .insert([{
        nom,
        email: emailClient,
        telephone,
        points: 0,
        restaurant_id: restaurant.id
      }])
      .select()
      .single();

    if (error) throw error;

    // On cree l'objet cote Google, puis on genere le lien a envoyer au client
    await wallet.creerObjetWallet(nouveauClient);
    const lienWallet = wallet.creerLienGoogleWallet(nouveauClient);

    // On cree aussi la carte Apple Wallet, et on garde son serialNumber
    // pour pouvoir la mettre a jour plus tard (scan, points, etc.)
    let lienAppleWallet = null;
    try {
      const passeApple = await appleWallet.creerPasseApple(
        nouveauClient,
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

    await email.envoyerEmailBienvenue(emailClient, nom, lienWallet, lienAppleWallet);

    res.json({
      client: nouveauClient,
      restaurant: { nom: restaurant.nom, slug: restaurant.slug },
      lienWallet,
      lienAppleWallet
    });
  } catch (erreur) {
    console.error(erreur);
    res.status(500).json({ erreur: erreur.message });
  }
});

// Enregistrer un scan depuis l'espace sécurisé du restaurateur.
app.post('/api/restaurateur/:slug/scan', async (req, res) => {
  try {
    const acces = await authentifierEspaceDesign(req, res);
    if (!acces) return;

    const { client_id, points_ajoutes } = req.body;
    const pointsAAjouter = points_ajoutes || 1;

    const { data: client, error: erreurLecture } = await supabase
      .from('clients')
      .select('*, restaurants(*)')
      .eq('id', client_id)
      .single();

    if (erreurLecture) throw erreurLecture;

    if (client.restaurant_id !== acces.restaurant.id) {
      return res.status(404).json({
        erreur: 'Cette carte n’appartient pas à votre établissement.'
      });
    }

    const nouveauSolde = client.points + pointsAAjouter;

    const { error: erreurMaj } = await supabase
      .from('clients')
      .update({ points: nouveauSolde })
      .eq('id', client_id);

    if (erreurMaj) throw erreurMaj;

    await supabase.from('scans').insert([{ client_id, points_ajoutes: pointsAAjouter }]);

    // Verifie si le client vient d'atteindre le seuil de recompense
    const restaurant = client.restaurants || null;
    const seuil = Number.parseInt(
      restaurant?.seuil_recompense || process.env.SEUIL_RECOMPENSE || '100',
      10
    );
    let recompenseAtteinte = false;
    let soldeFinal = nouveauSolde;

    if (client.points < seuil && nouveauSolde >= seuil) {
      recompenseAtteinte = true;
      soldeFinal = 0; // On remet le compteur a zero apres la recompense

      await supabase
        .from('clients')
        .update({ points: soldeFinal })
        .eq('id', client_id);

      try {
        await email.envoyerEmailRecompense(client.email, client.nom);
      } catch (erreurEmail) {
        console.error('Erreur envoi email recompense:', erreurEmail.message);
      }
    }

    // On met a jour la carte Google Wallet en temps reel
    await wallet.mettreAJourPointsWallet({ ...client, points: soldeFinal });

    // On met aussi a jour la carte Apple Wallet, si le client en a une
    if (client.apple_wallet_serial) {
      try {
        await appleWallet.mettreAJourPasseApple(
          client.apple_wallet_serial,
          { ...client, points: soldeFinal },
          restaurant
        );
      } catch (erreurApple) {
        console.error('Erreur mise a jour Apple Wallet:', erreurApple.message);
      }
    }

    res.json({
      succes: true,
      client_nom: client.nom,
      nouveauSolde: soldeFinal,
      recompenseAtteinte
    });
  } catch (erreur) {
    console.error(erreur);
    res.status(500).json({ erreur: erreur.message });
  }
});

// Liste des lots possibles, avec leur probabilite (doit totaliser 100)
// NOTE : le tirage est actuellement force sur "Boisson offerte" (voir tirerUnLot),
// la probabilite indiquee ici ne sert que si on desactive le forcage plus tard.
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
  // Le tirage est actuellement force : c'est toujours "Boisson offerte" qui sort,
  // pour garantir que chaque client ait une raison concrete de revenir.
  const indexForce = LOTS_ROUE.findIndex(l => l.label === 'Boisson offerte');
  const lot = LOTS_ROUE[indexForce];
  return { index: indexForce, label: lot.label, icone: lot.icone };
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serveur demarre sur le port ${PORT}`);
});
