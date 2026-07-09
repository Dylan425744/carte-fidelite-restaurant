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
const LOTS_ROUE = [
  { label: 'Café offert', probabilite: 10 },
  { label: '-10% sur l\'addition', probabilite: 20 },
  { label: 'Dessert offert', probabilite: 10 },
  { label: '-5% sur l\'addition', probabilite: 25 },
  { label: 'Rejouez bientôt', probabilite: 15 },
  { label: 'Perdu, à la prochaine !', probabilite: 20 }
];

function tirerUnLot() {
  const tirage = Math.random() * 100;
  let cumul = 0;
  for (let i = 0; i < LOTS_ROUE.length; i++) {
    cumul += LOTS_ROUE[i].probabilite;
    if (tirage <= cumul) return { index: i, label: LOTS_ROUE[i].label };
  }
  return { index: LOTS_ROUE.length - 1, label: LOTS_ROUE[LOTS_ROUE.length - 1].label };
}

// Verifie si un scan donne peut encore jouer a la roue
app.get('/api/roue/:scanId', async (req, res) => {
  try {
    const { data: scan, error } = await supabase
      .from('scans')
      .select('id, roue_utilisee, cadeau_gagne')
      .eq('id', req.params.scanId)
      .single();

    if (error || !scan) {
      return res.status(404).json({ erreur: 'Lien invalide ou expiré' });
    }

    res.json({
      peutJouer: !scan.roue_utilisee,
      cadeauDejaGagne: scan.cadeau_gagne || null,
      lots: LOTS_ROUE.map(l => l.label)
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
      .select('id, roue_utilisee')
      .eq('id', req.params.scanId)
      .single();

    if (erreurLecture || !scan) {
      return res.status(404).json({ erreur: 'Lien invalide ou expiré' });
    }

    if (scan.roue_utilisee) {
      return res.status(400).json({ erreur: 'Vous avez déjà joué avec ce lien' });
    }

    const lot = tirerUnLot();

    await supabase
      .from('scans')
      .update({ roue_utilisee: true, cadeau_gagne: lot.label })
      .eq('id', req.params.scanId);

    res.json({ indexLot: lot.index, label: lot.label });
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
