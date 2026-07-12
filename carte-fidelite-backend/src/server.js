require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');

const supabase = require('./supabaseClient');
const wallet = require('./walletService');
const appleWallet = require('./appleWalletService');
const email = require('./emailService');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Route a usage unique : configure la disposition personnalisee de la carte
// Google Wallet (lignes Client / Carte). Protegee par le meme mot de passe
// que le tableau de bord, pour eviter qu'elle soit appelee par n'importe qui.
app.post('/api/admin/configurer-template', async (req, res) => {
  try {
    const motDePasse = req.headers['x-dashboard-password'];
    if (motDePasse !== process.env.DASHBOARD_PASSWORD) {
      return res.status(401).json({ erreur: 'Mot de passe incorrect' });
    }

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
app.get('/api/clients', async (req, res) => {
  try {
    const motDePasse = req.headers['x-dashboard-password'];
    if (motDePasse !== process.env.DASHBOARD_PASSWORD) {
      return res.status(401).json({ erreur: 'Mot de passe incorrect' });
    }

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
    const { nom, email: emailClient, telephone } = req.body;

    const { data: nouveauClient, error } = await supabase
      .from('clients')
      .insert([{ nom, email: emailClient, telephone, points: 0 }])
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
      const passeApple = await appleWallet.creerPasseApple(nouveauClient);
      lienAppleWallet = passeApple.shareUrl;
      await supabase
        .from('clients')
        .update({ apple_wallet_serial: passeApple.serialNumber })
        .eq('id', nouveauClient.id);
    } catch (erreurApple) {
      console.error('Erreur creation Apple Wallet:', erreurApple.message);
    }

    await email.envoyerEmailBienvenue(emailClient, nom, lienWallet, lienAppleWallet);

    res.json({ client: nouveauClient, lienWallet, lienAppleWallet });
  } catch (erreur) {
    console.error(erreur);
    res.status(500).json({ erreur: erreur.message });
  }
});

// Enregistrer un scan (le restaurateur scanne la carte du client)
app.post('/api/scan', async (req, res) => {
  try {
    const { client_id, points_ajoutes } = req.body;
    const pointsAAjouter = points_ajoutes || 1;

    const { data: client, error: erreurLecture } = await supabase
      .from('clients')
      .select()
      .eq('id', client_id)
      .single();

    if (erreurLecture) throw erreurLecture;

    const nouveauSolde = client.points + pointsAAjouter;

    const { error: erreurMaj } = await supabase
      .from('clients')
      .update({ points: nouveauSolde })
      .eq('id', client_id);

    if (erreurMaj) throw erreurMaj;

    await supabase.from('scans').insert([{ client_id, points_ajoutes: pointsAAjouter }]);

    // Verifie si le client vient d'atteindre le seuil de recompense
    const seuil = parseInt(process.env.SEUIL_RECOMPENSE || '100');
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
        await appleWallet.mettreAJourPasseApple(client.apple_wallet_serial, { ...client, points: soldeFinal });
      } catch (erreurApple) {
        console.error('Erreur mise a jour Apple Wallet:', erreurApple.message);
      }
    }

    res.json({ succes: true, nouveauSolde: soldeFinal, recompenseAtteinte });
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
