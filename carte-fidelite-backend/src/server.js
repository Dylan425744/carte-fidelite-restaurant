require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');

const supabase = require('./supabaseClient');
const wallet = require('./walletService');
const appleWallet = require('./appleWalletService');
const email = require('./emailService');

const app = express();
app.use(cors());
app.use(express.json());

// Route de test pour verifier que le serveur tourne bien
app.get('/', (req, res) => {
  res.send('Le serveur de la carte de fidelite fonctionne.');
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

    // On met a jour la carte Google Wallet en temps reel
    await wallet.mettreAJourPointsWallet({ ...client, points: nouveauSolde });

    // On met aussi a jour la carte Apple Wallet, si le client en a une
    if (client.apple_wallet_serial) {
      try {
        await appleWallet.mettreAJourPasseApple(client.apple_wallet_serial, { ...client, points: nouveauSolde });
      } catch (erreurApple) {
        console.error('Erreur mise a jour Apple Wallet:', erreurApple.message);
      }
    }

    res.json({ succes: true, nouveauSolde });
  } catch (erreur) {
    console.error(erreur);
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
        await email.envoyerEmailAvis(scan.clients.email, scan.clients.nom);
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
