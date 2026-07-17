const parametres = new URLSearchParams(window.location.search);
const slug = parametres.get('restaurant') || 'chez-basile';
const modeAdmin = parametres.get('admin') === '1';
const couleursWallet = {
  dark: '#111111', blue: '#1378d1', green: '#128b66',
  red: '#c53c3c', purple: '#6d47c9', orange: '#d8781f'
};

let codeAcces = sessionStorage.getItem(`bravocard_design_${slug}`) || '';
let motDePasseAdmin = modeAdmin
  ? sessionStorage.getItem('bravocard_admin_password') || ''
  : '';
let restaurant = null;
let donneesTableau = null;
let minuteurCampagne = null;
let lecteurScanner = null;
let scanEnCours = false;

const $ = selecteur => document.querySelector(selecteur);

function echapper(valeur) {
  const element = document.createElement('div');
  element.textContent = valeur == null ? '' : String(valeur);
  return element.innerHTML;
}

function initiales(nom) {
  return String(nom || 'Commerce')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(mot => mot[0])
    .join('')
    .toUpperCase();
}

function entetes(avecJson = false) {
  return {
    ...(modeAdmin
      ? { 'x-dashboard-password': motDePasseAdmin }
      : { 'x-restaurant-access-code': codeAcces }),
    ...(avecJson ? { 'Content-Type': 'application/json' } : {})
  };
}

async function api(url, options = {}) {
  const reponse = await fetch(url, {
    ...options,
    headers: {
      ...entetes(Boolean(options.body)),
      ...(options.headers || {})
    }
  });
  const donnees = await reponse.json();
  if (!reponse.ok) throw new Error(donnees.erreur || 'Une erreur est survenue.');
  return donnees;
}

function afficherMessage(element, texte, type = '') {
  element.textContent = texte;
  element.className = `message ${type}`;
}

function formaterDate(date, avecHeure = false) {
  if (!date) return '-';
  return new Intl.DateTimeFormat('fr-FR', avecHeure
    ? { dateStyle: 'short', timeStyle: 'short' }
    : { dateStyle: 'short' }).format(new Date(date));
}

function nomPlateforme(plateforme) {
  return { toutes: 'Apple + Google', apple: 'Apple Wallet', google: 'Google Wallet' }[plateforme] || plateforme;
}

function ouvrirVue(nom) {
  if (nom !== 'scanner' && lecteurScanner && scanEnCours) {
    lecteurScanner.stop().catch(() => {});
    scanEnCours = false;
  }
  document.querySelectorAll('.vue').forEach(vue => vue.classList.remove('active'));
  document.querySelectorAll('.navigation').forEach(bouton => bouton.classList.remove('active'));
  $(`#vue-${nom}`).classList.add('active');
  document.querySelector(`.navigation[data-vue="${nom}"]`)?.classList.add('active');
  $('#titreVue').textContent = {
    accueil: 'Vue d’ensemble', scanner: 'Scanner une carte', clients: 'Mes clients',
    notifications: 'Notifications', design: 'Design Wallet'
  }[nom];
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function afficherResultatScan(type, titre, contenu) {
  const resultat = $('#resultatScan');
  resultat.className = `panneau resultat-scan ${type}`;
  resultat.innerHTML = `<div class="scan-illustration">${type === 'succes' ? '✓' : '!'}</div><h3>${echapper(titre)}</h3>${contenu}`;
}

async function demarrerScanner() {
  if (typeof Html5Qrcode === 'undefined') {
    afficherResultatScan('erreur', 'Scanner indisponible', '<p>Le module de caméra n’a pas pu être chargé. Vérifiez votre connexion.</p>');
    return;
  }

  $('#demarrerScanner').style.display = 'none';
  $('#relancerScanner').style.display = 'none';
  $('#lecteurRestaurateur').style.display = 'block';
  $('#resultatScan').className = 'panneau resultat-scan';
  $('#resultatScan').innerHTML = '<div class="scan-illustration">▥</div><h3>Caméra active</h3><p>Placez le code-barres au centre du cadre.</p>';

  try {
    if (lecteurScanner) {
      try { await lecteurScanner.clear(); } catch { /* Le lecteur était déjà nettoyé. */ }
    }
    lecteurScanner = new Html5Qrcode('lecteurRestaurateur');
    scanEnCours = true;
    await lecteurScanner.start(
      { facingMode: 'environment' },
      {
        fps: 10,
        qrbox: (largeur, hauteur) => ({
          width: Math.floor(largeur * 0.9),
          height: Math.min(140, Math.floor(hauteur * 0.35))
        })
      },
      traiterCodeScanne
    );
  } catch (erreur) {
    scanEnCours = false;
    $('#lecteurRestaurateur').style.display = 'none';
    $('#demarrerScanner').style.display = 'block';
    afficherResultatScan('erreur', 'Caméra inaccessible', '<p>Autorisez l’accès à la caméra dans les réglages de votre navigateur.</p>');
  }
}

async function traiterCodeScanne(code) {
  if (!scanEnCours) return;
  scanEnCours = false;
  try {
    await lecteurScanner.stop();
  } catch {
    // Le traitement du point peut continuer même si la caméra est déjà arrêtée.
  }
  $('#lecteurRestaurateur').style.display = 'none';
  $('#relancerScanner').style.display = 'block';

  try {
    const donnees = await api(`/api/restaurateur/${encodeURIComponent(slug)}/scan`, {
      method: 'POST', body: JSON.stringify({ client_id: code })
    });
    const contenu = donnees.recompenseAtteinte
      ? '<div class="solde-scan">Récompense !</div><p>Le compteur a été remis à zéro.</p>'
      : `<div class="solde-scan">${Number(donnees.nouveauSolde)} points</div><p>Nouveau solde de ${echapper(donnees.client_nom)}.</p>`;
    afficherResultatScan('succes', 'Point ajouté', contenu);
    await actualiserTableau(true);
  } catch (erreur) {
    afficherResultatScan('erreur', 'Scan refusé', `<p>${echapper(erreur.message)}</p>`);
  }
}

async function connecter() {
  const bouton = $('#boutonConnexion');
  bouton.disabled = true;
  afficherMessage($('#messageConnexion'), 'Connexion en cours...');

  try {
    const [design, tableau] = await Promise.all([
      api(`/api/design/${encodeURIComponent(slug)}`),
      api(`/api/restaurateur/${encodeURIComponent(slug)}/tableau-de-bord`)
    ]);
    restaurant = design.restaurant;
    donneesTableau = tableau;
    sessionStorage.setItem(
      modeAdmin ? 'bravocard_admin_password' : `bravocard_design_${slug}`,
      modeAdmin ? motDePasseAdmin : codeAcces
    );
    afficherApplication(tableau.administrateur);
    remplirDesign();
    afficherTableau();
    const vueDemandee = window.location.hash.replace('#', '');
    if (['scanner', 'clients', 'notifications', 'design'].includes(vueDemandee)) {
      ouvrirVue(vueDemandee);
    }
  } catch (erreur) {
    afficherMessage($('#messageConnexion'), erreur.message, 'erreur');
  } finally {
    bouton.disabled = false;
  }
}

function afficherApplication(administrateur) {
  $('#connexionPage').style.display = 'none';
  $('#application').classList.add('visible');
  $('#badgeAdmin').style.display = administrateur ? 'inline-flex' : 'none';
  $('#commerceNom').textContent = restaurant.nom;
  $('#commerceAvatar').textContent = initiales(restaurant.nom);
  $('#previewResto').textContent = restaurant.nom;
  $('#messageBienvenue').textContent = `Bonjour ${restaurant.nom} 👋`;
  document.title = `${restaurant.nom} - Espace Bravocard`;
}

function afficherTableau() {
  const stats = donneesTableau.statistiques;
  $('#statClients').textContent = stats.clients;
  $('#statActifs').textContent = `${stats.clients_actifs} actifs`;
  $('#statPoints').textContent = stats.points;
  $('#statApple').textContent = stats.cartes_apple;
  $('#statNotifications').textContent = stats.campagnes_24h;
  afficherClients(donneesTableau.clients);
  afficherDerniersClients();
  afficherHistorique();
  afficherDerniereCampagne();
  remplirClientsTest();

  const enCours = donneesTableau.notification_en_cours ||
    donneesTableau.notifications.some(campagne => campagne.statut === 'en_cours');
  $('#envoyerNotification').disabled = enCours || stats.campagnes_24h >= 3;
  $('#envoyerTest').disabled = enCours || stats.campagnes_24h >= 3 || !$('#clientTest').value;
  if (enCours) programmerActualisationCampagne();
}

function afficherClients(clients) {
  const recherche = $('#rechercheClients').value.trim().toLowerCase();
  const filtres = clients.filter(client =>
    [client.nom, client.email, client.telephone]
      .filter(Boolean)
      .some(valeur => String(valeur).toLowerCase().includes(recherche))
  );

  $('#tableClients').innerHTML = filtres.map(client => `
    <tr>
      <td><div class="client-cell"><span class="avatar-client">${echapper(initiales(client.nom))}</span><strong>${echapper(client.nom)}</strong></div></td>
      <td class="contact-cell">${echapper(client.email)}<span>${echapper(client.telephone || 'Téléphone non renseigné')}</span></td>
      <td><div class="wallet-badges">${client.apple_wallet ? '<span class="wallet-badge apple"> Apple</span>' : ''}<span class="wallet-badge google">G Google</span></div></td>
      <td><span class="points-badge">${Number(client.points || 0)} pts</span></td>
      <td>${formaterDate(client.date_inscription)}</td>
    </tr>`).join('');
  $('#aucunClient').style.display = filtres.length ? 'none' : 'block';
}

function afficherDerniersClients() {
  const clients = donneesTableau.clients.slice(0, 5);
  $('#derniersClients').innerHTML = clients.length
    ? clients.map(client => `<div class="ligne-simple"><span class="avatar-client">${echapper(initiales(client.nom))}</span><div><strong>${echapper(client.nom)}</strong><span>Inscrit le ${formaterDate(client.date_inscription)}</span></div><span class="points-badge">${Number(client.points || 0)} pts</span></div>`).join('')
    : '<div class="campagne-vide">Vos premiers clients apparaîtront ici.</div>';
}

function afficherDerniereCampagne() {
  const campagne = donneesTableau.notifications[0];
  $('#derniereCampagne').innerHTML = campagne
    ? `<div class="campagne-resume"><span>${formaterDate(campagne.created_at, true)} · ${echapper(nomPlateforme(campagne.plateforme))}</span><strong>${echapper(campagne.titre)}</strong><p>${echapper(campagne.message)}</p><span class="statut ${echapper(campagne.statut)}">${echapper(campagne.statut.replace('_', ' '))}</span></div>`
    : '<div class="campagne-vide">Aucune notification envoyée pour le moment.</div>';
}

function afficherHistorique() {
  const campagnes = donneesTableau.notifications;
  $('#historiqueNotifications').innerHTML = campagnes.length
    ? campagnes.map(campagne => {
        const reussies = Number(campagne.apple_reussies || 0) + Number(campagne.google_reussies || 0);
        const typeCampagne = campagne.test ? `Test · ${nomPlateforme(campagne.plateforme)}` : nomPlateforme(campagne.plateforme);
        return `<div class="campagne-ligne"><div><strong>${echapper(campagne.titre)}</strong><span>${formaterDate(campagne.created_at, true)}</span></div><div><strong>${echapper(campagne.message)}</strong><span>${echapper(typeCampagne)}</span></div><div><strong>${reussies}</strong><span>cartes mises à jour</span></div><span class="statut ${echapper(campagne.statut)}">${echapper(campagne.statut.replace('_', ' '))}</span></div>`;
      }).join('')
    : '<div class="campagne-vide">Votre historique de notifications apparaîtra ici.</div>';
}

async function actualiserTableau(silencieux = false) {
  try {
    donneesTableau = await api(`/api/restaurateur/${encodeURIComponent(slug)}/tableau-de-bord`);
    afficherTableau();
    if (!silencieux) afficherMessage($('#messageEnvoi'), 'Données actualisées.', 'succes');
  } catch (erreur) {
    if (!silencieux) afficherMessage($('#messageEnvoi'), erreur.message, 'erreur');
  }
}

function programmerActualisationCampagne() {
  clearTimeout(minuteurCampagne);
  minuteurCampagne = setTimeout(async () => {
    await actualiserTableau(true);
    const encoreEnCours = donneesTableau.notifications.some(campagne => campagne.statut === 'en_cours');
    if (encoreEnCours) programmerActualisationCampagne();
    else afficherMessage($('#messageEnvoi'), 'Campagne terminée. Consultez l’historique.', 'succes');
  }, 4000);
}

function remplirClientsTest() {
  const plateforme = document.querySelector('[name="plateforme"]:checked')?.value || 'toutes';
  const clients = donneesTableau.clients.filter(client =>
    plateforme !== 'apple' || client.apple_wallet
  );
  const ancienneValeur = $('#clientTest').value;
  $('#clientTest').innerHTML = clients.map(client =>
    `<option value="${echapper(client.id)}">${echapper(client.nom)}${client.apple_wallet ? ' · Apple' : ' · Google'}</option>`
  ).join('');
  if (clients.some(client => client.id === ancienneValeur)) $('#clientTest').value = ancienneValeur;
  $('#envoyerTest').disabled = !clients.length;
}

async function envoyerNotification(estTest = false) {
  const titre = $('#titreNotification').value.trim();
  const message = $('#messageNotification').value.trim();
  const plateforme = document.querySelector('[name="plateforme"]:checked').value;
  if (!titre || !message) {
    afficherMessage($('#messageEnvoi'), 'Ajoutez un titre et un message.', 'erreur');
    return;
  }
  const destinatairesEstimes = estTest ? 1 : plateforme === 'apple'
    ? donneesTableau.statistiques.cartes_apple
    : donneesTableau.statistiques.clients;
  const confirmation = estTest
    ? `Envoyer ce test uniquement à ${$('#clientTest').selectedOptions[0]?.textContent || 'la carte choisie'} ?`
    : `Envoyer cette notification aux ${destinatairesEstimes} clients concernés ?`;
  if (!window.confirm(confirmation)) return;

  const bouton = estTest ? $('#envoyerTest') : $('#envoyerNotification');
  bouton.disabled = true;
  afficherMessage($('#messageEnvoi'), 'Démarrage de la campagne...');
  try {
    await api(`/api/restaurateur/${encodeURIComponent(slug)}/notifications`, {
      method: 'POST',
      body: JSON.stringify({
        titre,
        message,
        plateforme,
        ...(estTest ? { client_id_test: $('#clientTest').value } : {})
      })
    });
    afficherMessage(
      $('#messageEnvoi'),
      estTest ? 'Test en cours sur la carte sélectionnée.' : 'Envoi en cours. Vous pouvez suivre sa progression ci-dessous.',
      'succes'
    );
    if (!estTest) {
      $('#titreNotification').value = '';
      $('#messageNotification').value = '';
      actualiserApercuNotification();
    }
    await actualiserTableau(true);
    programmerActualisationCampagne();
  } catch (erreur) {
    afficherMessage($('#messageEnvoi'), erreur.message, 'erreur');
    bouton.disabled = false;
  }
}

function actualiserApercuNotification() {
  $('#previewTitreNotification').textContent = $('#titreNotification').value || restaurant?.nom || 'Votre restaurant';
  $('#previewMessageNotification').textContent = $('#messageNotification').value || 'Votre message apparaîtra ici.';
  $('#compteurMessage').textContent = $('#messageNotification').value.length;
}

function remplirDesign() {
  const preset = document.querySelector(`[name="preset"][value="${restaurant.apple_color_preset}"]`);
  if (preset) preset.checked = true;
  const correspondances = {
    logoText: 'apple_logo_text', pointsLabel: 'apple_points_label',
    cardLabel: 'apple_card_label', customColor: 'apple_custom_color',
    logoUrl: 'apple_logo_url', stripUrl: 'apple_strip_url', iconUrl: 'apple_icon_url'
  };
  for (const [id, champ] of Object.entries(correspondances)) $(`#${id}`).value = restaurant[champ] || '';
  $('#zonePro').classList.toggle('verrouille', !restaurant.pro_autorise);
  $('#messagePro').textContent = restaurant.pro_disponible
    ? 'Activation réservée à Bravocard'
    : 'Abonnement WalletWallet Pro requis';
  actualiserApercuWallet();
}

function actualiserApercuWallet() {
  const preset = document.querySelector('[name="preset"]:checked')?.value || 'dark';
  const exacte = $('#customColor').value;
  $('#wallet').style.background = restaurant?.pro_autorise && /^#[0-9a-f]{6}$/i.test(exacte)
    ? exacte : couleursWallet[preset];
  $('#previewLogo').textContent = $('#logoText').value || 'Bravocard';
  $('#previewPointsLabel').textContent = $('#pointsLabel').value || 'POINTS FIDÉLITÉ';
  $('#previewCardLabel').textContent = $('#cardLabel').value || 'FIDÉLITÉ';
}

async function lireFichier(input, cible) {
  const fichier = input.files[0];
  if (!fichier) return;
  if (fichier.type !== 'image/png' || fichier.size > 500000) {
    afficherMessage($('#messageDesign'), 'Choisissez un PNG de moins de 500 Ko.', 'erreur');
    input.value = '';
    return;
  }
  const lecteur = new FileReader();
  lecteur.onload = () => { $(`#${cible}`).value = lecteur.result; };
  lecteur.readAsDataURL(fichier);
}

async function enregistrerDesign() {
  const bouton = $('#enregistrerDesign');
  bouton.disabled = true;
  afficherMessage($('#messageDesign'), 'Enregistrement...');
  const corps = {
    apple_color_preset: document.querySelector('[name="preset"]:checked').value,
    apple_logo_text: $('#logoText').value,
    apple_points_label: $('#pointsLabel').value,
    apple_card_label: $('#cardLabel').value,
    apple_custom_color: $('#customColor').value,
    apple_logo_url: $('#logoUrl').value,
    apple_strip_url: $('#stripUrl').value,
    apple_icon_url: $('#iconUrl').value
  };
  try {
    const donnees = await api(`/api/design/${encodeURIComponent(slug)}`, {
      method: 'PUT', body: JSON.stringify(corps)
    });
    restaurant = donnees.restaurant;
    afficherMessage($('#messageDesign'), 'Design enregistré.', 'succes');
  } catch (erreur) {
    afficherMessage($('#messageDesign'), erreur.message, 'erreur');
  } finally {
    bouton.disabled = false;
  }
}

document.querySelectorAll('.navigation').forEach(bouton => bouton.addEventListener('click', () => ouvrirVue(bouton.dataset.vue)));
document.querySelectorAll('[data-ouvrir-vue]').forEach(bouton => bouton.addEventListener('click', () => ouvrirVue(bouton.dataset.ouvrirVue)));
$('#rechercheClients').addEventListener('input', () => afficherClients(donneesTableau.clients));
$('#messageNotification').addEventListener('input', actualiserApercuNotification);
$('#titreNotification').addEventListener('input', actualiserApercuNotification);
$('#envoyerNotification').addEventListener('click', () => envoyerNotification(false));
$('#envoyerTest').addEventListener('click', () => envoyerNotification(true));
document.querySelectorAll('[name="plateforme"]').forEach(input => input.addEventListener('change', remplirClientsTest));
$('#actualiserCampagnes').addEventListener('click', () => actualiserTableau());
$('#demarrerScanner').addEventListener('click', demarrerScanner);
$('#relancerScanner').addEventListener('click', demarrerScanner);
$('#enregistrerDesign').addEventListener('click', enregistrerDesign);
document.querySelectorAll('.editeur-design input').forEach(input => input.addEventListener('input', actualiserApercuWallet));
$('#logoFile').addEventListener('change', evenement => lireFichier(evenement.target, 'logoUrl'));
$('#stripFile').addEventListener('change', evenement => lireFichier(evenement.target, 'stripUrl'));
$('#iconFile').addEventListener('change', evenement => lireFichier(evenement.target, 'iconUrl'));
$('#deconnexion').addEventListener('click', () => {
  sessionStorage.removeItem(modeAdmin ? 'bravocard_admin_password' : `bravocard_design_${slug}`);
  window.location.reload();
});

$('#boutonConnexion').addEventListener('click', () => {
  if (modeAdmin) motDePasseAdmin = $('#codeAcces').value;
  else codeAcces = $('#codeAcces').value.trim();
  connecter();
});
$('#codeAcces').addEventListener('keydown', evenement => {
  if (evenement.key === 'Enter') $('#boutonConnexion').click();
});

if (modeAdmin && !motDePasseAdmin) {
  $('#titreConnexion').textContent = 'Accès administrateur';
  $('#texteConnexion').textContent = 'Entrez votre mot de passe principal Bravocard pour superviser cet établissement.';
  $('#codeAcces').placeholder = 'Mot de passe administrateur';
} else if (codeAcces || motDePasseAdmin) {
  connecter();
}
