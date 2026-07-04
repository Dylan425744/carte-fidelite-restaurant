require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');

const supabase = require('./supabaseClient');
const wallet = require('./walletService');
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

    await email.envoyerEmailBienvenue(emailClient, nom, lienWallet);

    res.json({ client: nouveauClient, lienWallet });
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
