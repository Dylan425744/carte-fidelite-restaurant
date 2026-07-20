const parametres = new URLSearchParams(window.location.search);
let slug = (parametres.get('restaurant') || '').trim();
const modeAdmin = parametres.get('admin') === '1';
const offres = {
  starter: { nom: 'Essentiel', prix: '29 € HT / mois', limite: '1 établissement' },
  pro: { nom: 'Croissance', prix: '49 € HT / mois', limite: '1 établissement' },
  premium: { nom: 'Signature', prix: '89 € HT / mois', limite: 'jusqu’à 5 établissements' }
};
const planDemande = offres[parametres.get('plan')] ? parametres.get('plan') : null;
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
let utilisationCompte = false;
let sessionUtilisateur = null;
let etablissements = [];
let permissions = [];
let abonnement = null;
let etablissementsBloques = [];
let supportsMarketing = null;
let kitCommunication = null;
let genEtat = { support: null, theme: null };
let genMinuteurApercu = null;
let walletSpecifications = null;
let walletPlateformeActive = 'apple';
let walletZonesSecuriteActives = false;
let walletRecadrage = { cropper: null, assetElement: null };
let roueLotsEdition = [];

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
    ...(!utilisationCompte && modeAdmin
      ? { 'x-dashboard-password': motDePasseAdmin }
      : {}),
    ...(!utilisationCompte && !modeAdmin && codeAcces
      ? { 'x-restaurant-access-code': codeAcces }
      : {}),
    ...(avecJson ? { 'Content-Type': 'application/json' } : {})
  };
}

async function api(url, options = {}, autoriserRafraichissement = true) {
  const reponse = await fetch(url, {
    ...options,
    headers: {
      ...entetes(Boolean(options.body)),
      ...(options.headers || {})
    }
  });
  if (
    reponse.status === 401 &&
    utilisationCompte &&
    autoriserRafraichissement &&
    !url.startsWith('/api/auth/')
  ) {
    const actualisation = await fetch('/api/auth/actualiser', { method: 'POST' });
    if (actualisation.ok) return api(url, options, false);
  }
  const donnees = await reponse.json();
  if (!reponse.ok) throw new Error(donnees.erreur || 'Une erreur est survenue.');
  return donnees;
}

function aPermission(permission) {
  return permissions.includes('*') || permissions.includes(permission);
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
  const cible = $(`#vue-${nom}`);
  const navigation = document.querySelector(`.navigation[data-vue="${nom}"]`);
  if (!cible || navigation?.classList.contains('masquee')) return;
  if (nom !== 'scanner' && lecteurScanner && scanEnCours) {
    lecteurScanner.stop().catch(() => {});
    scanEnCours = false;
  }
  document.querySelectorAll('.vue').forEach(vue => vue.classList.remove('active'));
  document.querySelectorAll('.navigation').forEach(bouton => bouton.classList.remove('active'));
  cible.classList.add('active');
  navigation?.classList.add('active');
  $('#titreVue').textContent = {
    accueil: 'Vue d’ensemble', statistiques: 'Statistiques détaillées',
    scanner: 'Scanner une carte', clients: 'Mes clients',
    parrainage: 'Parrainage', 'anti-fraude': 'Anti-fraude',
    notifications: 'Notifications', roue: 'Roue cadeaux', design: 'Design Wallet',
    marketing: 'QR & flyer',
    equipe: 'Mon équipe', compte: 'Mon compte'
  }[nom];
  if (nom === 'equipe') chargerEquipe();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function afficherOffreDemandee() {
  const zone = $('#offreSelectionnee');
  const lienCreation = $('#creerComptePaiement');
  if (lienCreation) lienCreation.href = `/inscription.html?plan=${planDemande || 'pro'}`;
  if (!zone || !planDemande || modeAdmin) return;
  zone.classList.add('visible');
  $('#nomOffreSelectionnee').textContent = offres[planDemande].nom;
  $('#detailOffreSelectionnee').textContent = `${offres[planDemande].prix} · ${offres[planDemande].limite}`;
  $('#titreConnexion').textContent = `Continuez avec ${offres[planDemande].nom}`;
  $('#texteConnexion').textContent = 'Votre offre est bien conservée. Connectez-vous pour la vérifier puis ouvrir le paiement sécurisé Stripe.';
}

function ouvrirChoixAbonnement(plan) {
  ouvrirVue('compte');
  document.querySelectorAll('[data-plan]').forEach(bouton =>
    bouton.classList.toggle('selectionne', bouton.dataset.plan === plan)
  );
  const cible = document.querySelector(`[data-plan="${plan}"]`);
  if (cible) {
    cible.querySelector('b').textContent = `Continuer avec ${offres[plan].nom}`;
    setTimeout(() => cible.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
  }
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
  const formatQr = restaurant?.wallet_barcode_format === 'QR_CODE';
  const typeCode = formatQr ? 'QR code' : 'code-barres';
  $('#resultatScan').innerHTML = `<div class="scan-illustration">▥</div><h3>Caméra active</h3><p>Placez le ${typeCode} au centre du cadre.</p>`;

  try {
    if (lecteurScanner) {
      try { await lecteurScanner.clear(); } catch { /* Le lecteur était déjà nettoyé. */ }
    }
    lecteurScanner = new Html5Qrcode('lecteurRestaurateur', {
      formatsToSupport: [formatQr
        ? Html5QrcodeSupportedFormats.QR_CODE
        : Html5QrcodeSupportedFormats.CODE_128]
    });
    scanEnCours = true;
    await lecteurScanner.start(
      { facingMode: 'environment' },
      {
        fps: 10,
        qrbox: (largeur, hauteur) => formatQr
          ? (() => {
              const cote = Math.floor(Math.min(largeur, hauteur) * 0.72);
              return { width: cote, height: cote };
            })()
          : {
              width: Math.floor(largeur * 0.9),
              height: Math.min(140, Math.floor(hauteur * 0.35))
            }
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
    let contenu = donnees.recompenseAtteinte
      ? '<div class="solde-scan">Récompense !</div><p>Le compteur a été remis à zéro.</p>'
      : `<div class="solde-scan">${Number(donnees.nouveauSolde)} points</div><p>Nouveau solde de ${echapper(donnees.client_nom)}.</p>`;
    if (donnees.parrainage_valide) {
      contenu += `<div class="info-envoi"><span>✓</span><p>Parrainage validé : ${Number(donnees.bonus_filleul)} points pour le filleul et ${Number(donnees.bonus_parrain)} points pour le parrain.</p></div>`;
    }
    afficherResultatScan(
      'succes',
      `${Number(donnees.points_ajoutes || 10)} points ajoutés`,
      contenu
    );
    if (aPermission('dashboard')) await actualiserTableau(true);
  } catch (erreur) {
    afficherResultatScan('erreur', 'Scan refusé', `<p>${echapper(erreur.message)}</p>`);
  }
}

async function chargerEspace() {
  const requetes = [api(`/api/restaurants/${encodeURIComponent(slug)}/public`)];
  const indexTableau = aPermission('dashboard') ? requetes.push(
    api(`/api/restaurateur/${encodeURIComponent(slug)}/tableau-de-bord`)
  ) - 1 : -1;
  const indexDesign = aPermission('design_view') ? requetes.push(
    api(`/api/design/${encodeURIComponent(slug)}`)
  ) - 1 : -1;
  const resultats = await Promise.all(requetes);
  donneesTableau = indexTableau >= 0 ? resultats[indexTableau] : null;
  const design = indexDesign >= 0 ? resultats[indexDesign] : null;
  restaurant = design?.restaurant || donneesTableau?.restaurant || resultats[0].restaurant;

  if (!utilisationCompte) {
    sessionStorage.setItem(
      modeAdmin ? 'bravocard_admin_password' : `bravocard_design_${slug}`,
      modeAdmin ? motDePasseAdmin : codeAcces
    );
  }
  afficherApplication(Boolean(donneesTableau?.administrateur || sessionUtilisateur?.super_admin));
  appliquerPermissions();
  if (design) remplirDesign();
  if (donneesTableau) afficherTableau();
  if (aPermission('marketing_view')) {
    chargerSupportsMarketing().catch(erreur =>
      afficherMessage($('#messageMarketing'), erreur.message, 'erreur')
    );
    chargerKitCommunication().catch(erreur =>
      afficherMessage($('#messageGenerateur'), erreur.message, 'erreur')
    );
  }

  const vueDemandee = window.location.hash.replace('#', '');
  const vueParDefaut = aPermission('dashboard') ? 'accueil' : (aPermission('scan') ? 'scanner' : 'compte');
  const navigationDemandee = document.querySelector(`.navigation[data-vue="${vueDemandee}"]`);
  ouvrirVue(vueDemandee && !navigationDemandee?.classList.contains('masquee')
    ? vueDemandee
    : (planDemande && sessionUtilisateur ? 'compte' : vueParDefaut));
  if (planDemande && sessionUtilisateur) ouvrirChoixAbonnement(planDemande);
}

async function restaurerCompte() {
  utilisationCompte = true;
  let moi;
  try {
    moi = await api('/api/auth/moi');
  } catch (erreur) {
    const actualisation = await fetch('/api/auth/actualiser', { method: 'POST' });
    if (!actualisation.ok) throw erreur;
    moi = await api('/api/auth/moi');
  }
  sessionUtilisateur = moi.utilisateur;
  etablissements = moi.etablissements || [];
  abonnement = moi.abonnement || null;
  etablissementsBloques = moi.etablissements_bloques || [];
  if (etablissements.length === 0) {
    throw new Error('Aucun établissement n’est associé à ce compte.');
  }
  const demande = etablissements.find(entree => entree.slug === slug);
  const choisi = demande || etablissements[0];
  slug = choisi.slug;
  permissions = choisi.permissions || [];
  await chargerEspace();
}

async function connecterCompte() {
  const bouton = $('#boutonConnexion');
  bouton.disabled = true;
  afficherMessage($('#messageConnexion'), 'Connexion en cours...');
  try {
    const reponse = await fetch('/api/auth/connexion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: $('#emailConnexion').value,
        password: $('#motDePasseConnexion').value
      })
    });
    const donnees = await reponse.json();
    if (!reponse.ok) throw new Error(donnees.erreur || 'Connexion impossible.');
    await restaurerCompte();
  } catch (erreur) {
    utilisationCompte = false;
    afficherMessage($('#messageConnexion'), erreur.message, 'erreur');
  } finally {
    bouton.disabled = false;
  }
}

async function connecterHistorique() {
  const bouton = $('#boutonConnexionHistorique');
  bouton.disabled = true;
  afficherMessage($('#messageConnexion'), 'Vérification du code...');
  try {
    utilisationCompte = false;
    permissions = ['*'];
    if (modeAdmin) motDePasseAdmin = $('#codeAcces').value;
    else codeAcces = $('#codeAcces').value.trim();
    await chargerEspace();
  } catch (erreur) {
    afficherMessage($('#messageConnexion'), erreur.message, 'erreur');
  } finally {
    bouton.disabled = false;
  }
}

function libelleRole(role) {
  return {
    super_admin: 'Super-administrateur', owner: 'Propriétaire',
    manager: 'Manager', employee: 'Employé'
  }[role] || 'Compte commerçant';
}

function afficherAbonnement() {
  const zone = $('#abonnementCompte');
  if (!zone) return;
  const estProprietaire = etablissements.some(entree => entree.role === 'owner');
  zone.classList.toggle('visible', Boolean(sessionUtilisateur && estProprietaire && !sessionUtilisateur.super_admin));
  if (!sessionUtilisateur || !estProprietaire || sessionUtilisateur.super_admin) return;

  const libelles = { starter: 'Essentiel', pro: 'Croissance', premium: 'Signature' };
  const plan = abonnement?.plan || 'starter';
  const actif = Boolean(abonnement?.actif);
  const statuts = {
    inactive: 'À activer', incomplete: 'Paiement à finaliser',
    incomplete_expired: 'Paiement expiré', past_due: 'À régulariser',
    unpaid: 'Impayé', canceled: 'Résilié', paused: 'Suspendu'
  };
  $('#nomForfait').textContent = libelles[plan] || 'Essentiel';
  $('#statutForfait').textContent = actif
    ? (abonnement?.statut === 'trialing' ? 'Essai en cours' : 'Actif')
    : (statuts[abonnement?.statut] || 'À activer');
  $('#texteForfait').textContent = actif
    ? `Votre forfait permet de piloter jusqu’à ${abonnement.limite_etablissements} établissement${abonnement.limite_etablissements > 1 ? 's' : ''}.`
    : 'Essai de 14 jours, sans engagement. Vous choisissez le forfait adapté à votre croissance.';
  $('#restaurantsVerrouilles').innerHTML = etablissementsBloques.map(entree =>
    `<span>🔒 ${echapper(entree.nom)} — augmentez votre forfait pour y accéder</span>`
  ).join('');
  $('#gererAbonnement').style.display = abonnement?.client_stripe ? '' : 'none';
  document.querySelectorAll('[data-plan]').forEach(bouton => {
    const estPlanActuel = bouton.dataset.plan === plan && actif;
    bouton.classList.toggle('actif', estPlanActuel);
    bouton.classList.toggle('selectionne', Boolean(planDemande && bouton.dataset.plan === planDemande && !estPlanActuel));
    bouton.disabled = estPlanActuel;
    bouton.querySelector('b').textContent = estPlanActuel
      ? 'Forfait actuel'
      : (planDemande === bouton.dataset.plan ? `Continuer avec ${offres[bouton.dataset.plan].nom}` : 'Choisir');
  });
  const planSuivant = plan === 'pro' && actif ? 'premium' : 'pro';
  const afficherUpgrade = plan !== 'premium' || !actif;
  $('#upgradeSidebar').classList.toggle('visible', afficherUpgrade);
  $('#upgradeEntete').classList.toggle('visible', afficherUpgrade);
  $('#upgradeSidebar').dataset.plan = planSuivant;
  $('#upgradeEntete').dataset.plan = planSuivant;
  $('#upgradeTitre').textContent = `Passez à ${offres[planSuivant].nom}`;
  $('#upgradeEntete').textContent = `Passer à ${offres[planSuivant].nom}`;
  $('#upgradeTexte').textContent = planSuivant === 'premium'
    ? 'Débloquez jusqu’à 5 établissements et le studio Wallet avancé.'
    : 'Débloquez les statistiques détaillées et le pilotage d’équipe.';
  if (planDemande && planDemande !== plan) {
    afficherMessage($('#messageAbonnement'), `Votre choix ${offres[planDemande].nom} a été conservé. Vérifiez-le puis continuez vers Stripe.`, 'succes');
  }
  if (!abonnement?.stripe_configure) {
    $('#texteForfait').textContent = 'La facturation est en cours de configuration par Bravocard.';
  }
}

function appliquerPermissions() {
  const correspondances = {
    accueil: 'dashboard', statistiques: 'statistics', scanner: 'scan',
    clients: 'clients', parrainage: 'referral_view', 'anti-fraude': 'fraud_view',
    notifications: 'notifications', roue: 'dashboard', design: 'design_view',
    marketing: 'marketing_view', equipe: 'team_manage'
  };
  for (const [vue, permission] of Object.entries(correspondances)) {
    document.querySelector(`.navigation[data-vue="${vue}"]`)
      ?.classList.toggle('masquee', !aPermission(permission));
  }
  document.querySelectorAll('[data-ouvrir-vue="notifications"]').forEach(element =>
    element.classList.toggle('masquee', !aPermission('notifications'))
  );
  document.querySelector('.navigation[data-vue="compte"]')
    ?.classList.toggle('masquee', !sessionUtilisateur);
  $('#enregistrerParrainage').style.display = aPermission('referral_manage') ? '' : 'none';
  $('#enregistrerAntiFraude').style.display = aPermission('fraud_manage') ? '' : 'none';
  $('#enregistrerDesign').style.display = aPermission('design_manage') ? '' : 'none';
  $('#enregistrerRoue').style.display = aPermission('design_manage') ? '' : 'none';
  $('#ajouterLot').style.display = aPermission('design_manage') ? '' : 'none';
  $('#regenererSupports').style.display = aPermission('marketing_manage') ? '' : 'none';
  $('#genEnregistrer').style.display = aPermission('marketing_manage') ? '' : 'none';
  $('#roleMembre').querySelector('option[value="owner"]').hidden = !sessionUtilisateur?.super_admin;

  if (sessionUtilisateur) {
    $('#nomCompte').textContent = sessionUtilisateur.nom;
    $('#emailCompte').textContent = sessionUtilisateur.email;
    $('#avatarCompte').textContent = initiales(sessionUtilisateur.nom);
  }
  const etablissement = etablissements.find(entree => entree.slug === slug);
  $('#consoleSuperAdmin').hidden = !sessionUtilisateur?.super_admin;
  $('#alerteAbonnementBloque').hidden = !etablissement?.billing_locked;
  if (etablissement?.billing_locked) {
    $('#texteAbonnementBloque').textContent = etablissement.role === 'owner'
      ? 'Les fonctions du restaurant sont suspendues. Choisissez ou régularisez votre forfait ci-dessous pour les réactiver immédiatement.'
      : 'Les fonctions du restaurant sont suspendues. Demandez au propriétaire de régulariser l’abonnement Bravocard.';
  }
  $('#libelleRole').textContent = libelleRole(etablissement?.role);
  $('#selectEtablissement').innerHTML = etablissements.map(entree =>
    `<option value="${echapper(entree.slug)}" ${entree.slug === slug ? 'selected' : ''}>${echapper(entree.nom)} - ${echapper(libelleRole(entree.role))}</option>`
  ).join('');
  $('#zoneEtablissement').classList.toggle('visible', etablissements.length > 1);
  afficherAbonnement();
}

function afficherApplication(administrateur) {
  $('#connexionPage').style.display = 'none';
  $('#application').classList.add('visible');
  $('#badgeAdmin').style.display = administrateur ? 'inline-flex' : 'none';
  $('#commerceNom').textContent = restaurant.nom;
  $('#commerceAvatar').textContent = initiales(restaurant.nom);
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
  afficherParrainage();
  afficherAntiFraude();
  afficherStatistiques();
  remplirApercuRoue();
  afficherHistoriqueRoue();

  const enCours = donneesTableau.notification_en_cours ||
    donneesTableau.notifications.some(campagne => campagne.statut === 'en_cours');
  $('#envoyerNotification').disabled = enCours || stats.campagnes_24h >= 3;
  $('#envoyerTest').disabled = enCours || stats.campagnes_24h >= 3 || !$('#clientTest').value;
  if (enCours) programmerActualisationCampagne();
}

const lotsRoueParDefaut = [
  { label: 'Menu offert', icone: '🍽️' },
  { label: '-10% addition', icone: '🏷️' },
  { label: 'Dessert offert', icone: '🍰' },
  { label: 'Boisson offerte', icone: '🥤' },
  { label: 'Rejouez', icone: '🔁' },
  { label: 'Pas de gain', icone: '✨' }
];
let rotationApercuRoue = 0;

function lotsRoue() {
  return donneesTableau?.roue?.lots?.length
    ? donneesTableau.roue.lots
    : lotsRoueParDefaut;
}

// Palette et geometrie identiques a public/roue.html et public/avis-roue.html
// (memes constantes, meme fonction de dessin) pour garantir un apercu fidele.
const COULEURS_ROUE_REELLE = ['#6C3CE9', '#12B886', '#5A2FD0', '#0E9469', '#7C4FF0', '#0A7A56'];
const RAYON_TEXTE_ROUE = 112;

function dessinerRoueReelle(conteneur, lots, couleurPrincipale, couleurSecondaire) {
  const nb = lots.length;
  const angle = 360 / nb;
  const palette = (couleurPrincipale && couleurSecondaire) ? [couleurPrincipale, couleurSecondaire] : COULEURS_ROUE_REELLE;
  const degrades = lots.map((lot, i) => {
    const debut = i * angle;
    return `${palette[i % palette.length]} ${debut}deg ${debut + angle}deg`;
  });
  conteneur.style.background = `conic-gradient(${degrades.join(',')})`;
  conteneur.querySelectorAll('.segment-pivot').forEach(noeud => noeud.remove());
  lots.forEach((lot, i) => {
    const centreAngle = i * angle + angle / 2;
    const pivot = document.createElement('div');
    pivot.className = 'segment-pivot';
    pivot.style.transform = `rotate(${centreAngle}deg)`;
    const contenu = document.createElement('div');
    contenu.className = 'segment-contenu';
    contenu.style.transform = `translateY(-${RAYON_TEXTE_ROUE}px) rotate(${-centreAngle}deg)`;
    contenu.innerHTML = `<div class="icone-lot">${echapper(lot.icone)}</div><div class="texte-lot">${echapper(lot.label)}</div>`;
    pivot.appendChild(contenu);
    conteneur.appendChild(pivot);
  });
}

function actualiserCouleursApercuRoue() {
  const roue = $('#roueApercu');
  if (!roue) return;
  dessinerRoueReelle(roue, lotsRoue(), $('#roueCouleurPrincipale').value, $('#roueCouleurSecondaire').value);
}

function remplirApercuRoue() {
  const roue = $('#roueApercu');
  if (!roue) return;
  const lots = lotsRoue();
  roueLotsEdition = lots.map(lot => ({ icone: lot.icone, label: lot.label, probabilite: Number(lot.probabilite) || 10 }));
  afficherLotsEdition();
  if (!$('#roueCouleurPrincipale').value || $('#roueCouleurPrincipale').dataset.rempli !== 'oui') {
    $('#roueCouleurPrincipale').value = donneesTableau?.roue?.couleur_principale || '#6C3CE9';
    $('#roueCouleurSecondaire').value = donneesTableau?.roue?.couleur_secondaire || '#E8891F';
    $('#roueCouleurPrincipale').dataset.rempli = 'oui';
  }
  actualiserCouleursApercuRoue();
}

function afficherHistoriqueRoue() {
  const historique = donneesTableau?.roue?.historique || [];
  const corps = $('#tableHistoriqueRoue');
  if (!corps) return;
  $('#resumeHistoriqueRoue').textContent = `${historique.length} tour${historique.length > 1 ? 's' : ''}`;
  corps.innerHTML = historique.map(ligne => `
    <tr>
      <td><div class="client-cell"><span class="avatar-client">${echapper(initiales(ligne.client))}</span><strong>${echapper(ligne.client)}</strong></div></td>
      <td>${formaterDate(ligne.date, true)}</td>
      <td><strong>${echapper(ligne.gain)}</strong></td>
      <td>${echapper(ligne.parcours)}</td>
      <td><span class="etat-membre ${ligne.utilise ? 'actif' : 'inactif'}">${ligne.utilise ? 'Retiré' : 'En attente'}</span></td>
    </tr>`).join('');
  $('#aucunHistoriqueRoue').style.display = historique.length ? 'none' : 'block';
}

function afficherLotsEdition() {
  const peutModifier = aPermission('design_manage');
  $('#listeLotsEdition').innerHTML = roueLotsEdition.map((lot, index) => `
    <div class="ligne-lot-edition" data-index="${index}">
      <input type="text" class="lot-icone" maxlength="4" value="${echapper(lot.icone)}" aria-label="Icône" ${peutModifier ? '' : 'disabled'}>
      <input type="text" class="lot-label" maxlength="40" value="${echapper(lot.label)}" aria-label="Nom du lot" ${peutModifier ? '' : 'disabled'}>
      <input type="number" class="lot-probabilite" min="1" max="100" value="${Number(lot.probabilite) || 10}" aria-label="Probabilité" ${peutModifier ? '' : 'disabled'}>
      ${peutModifier ? `<button type="button" data-supprimer-lot="${index}" title="Supprimer ce lot">✕</button>` : ''}
    </div>`).join('');
}

function lireLotsDepuisFormulaire() {
  return [...document.querySelectorAll('.ligne-lot-edition')].map(ligne => ({
    icone: ligne.querySelector('.lot-icone').value.trim(),
    label: ligne.querySelector('.lot-label').value.trim(),
    probabilite: Number(ligne.querySelector('.lot-probabilite').value)
  }));
}

function ajouterLigneLot() {
  roueLotsEdition = lireLotsDepuisFormulaire();
  roueLotsEdition.push({ icone: '🎁', label: 'Nouveau lot', probabilite: 10 });
  afficherLotsEdition();
}

function supprimerLigneLot(index) {
  roueLotsEdition = lireLotsDepuisFormulaire();
  if (roueLotsEdition.length <= 2) {
    afficherMessage($('#messageRoue'), 'La roue doit contenir au moins 2 lots.', 'erreur');
    return;
  }
  roueLotsEdition.splice(index, 1);
  afficherLotsEdition();
}

async function enregistrerRoue() {
  const bouton = $('#enregistrerRoue');
  bouton.disabled = true;
  afficherMessage($('#messageRoue'), 'Enregistrement...');
  try {
    const donnees = await api(`/api/restaurateur/${encodeURIComponent(slug)}/roue`, {
      method: 'PUT',
      body: JSON.stringify({
        lots: lireLotsDepuisFormulaire(),
        couleur_principale: $('#roueCouleurPrincipale').value,
        couleur_secondaire: $('#roueCouleurSecondaire').value
      })
    });
    donneesTableau.roue = donnees.roue;
    roueLotsEdition = donnees.roue.lots;
    afficherLotsEdition();
    remplirApercuRoue();
    afficherMessage($('#messageRoue'), donnees.message, 'succes');
  } catch (erreur) {
    afficherMessage($('#messageRoue'), erreur.message, 'erreur');
  } finally {
    bouton.disabled = false;
  }
}

async function validerCadeauComptoir() {
  const bouton = $('#validerCadeau');
  const code = $('#codeCadeauSaisie').value.trim().toUpperCase();
  if (!code) return;
  bouton.disabled = true;
  afficherMessage($('#messageCadeau'), 'Vérification...');
  try {
    const donnees = await api(`/api/restaurateur/${encodeURIComponent(slug)}/cadeaux/valider`, {
      method: 'POST',
      body: JSON.stringify({ code })
    });
    afficherMessage($('#messageCadeau'), `✓ ${donnees.cadeau} validé (valable jusqu’au ${formaterDate(donnees.valide_au)}).`, 'succes');
    $('#codeCadeauSaisie').value = '';
  } catch (erreur) {
    afficherMessage($('#messageCadeau'), erreur.message, 'erreur');
  } finally {
    bouton.disabled = false;
  }
}

function lancerApercuRoue() {
  const bouton = $('#lancerApercuRoue');
  const resultat = $('#resultatApercuRoue');
  const roue = $('#roueApercu');
  const lots = lotsRoue();
  if (!roue || !lots.length || bouton.disabled) return;
  const index = Math.floor(Math.random() * lots.length);
  const angle = 360 / lots.length;
  const cible = (360 - (index * angle + angle / 2) + 360) % 360;
  const positionActuelle = ((rotationApercuRoue % 360) + 360) % 360;
  const mouvementVersCible = (cible - positionActuelle + 360) % 360;
  rotationApercuRoue += 360 * 5 + mouvementVersCible;
  bouton.disabled = true;
  resultat.textContent = 'La roue tourne…';
  roue.style.transform = `rotate(${rotationApercuRoue}deg)`;
  window.setTimeout(() => {
    resultat.textContent = `Aperçu : ${lots[index].icone} ${lots[index].label}`;
    bouton.disabled = false;
  }, 5300);
}

async function copierLienCreationCarte() {
  const bouton = $('#copierLienCarte');
  const lien = `${window.location.origin}/creer-carte.html?restaurant=${encodeURIComponent(slug)}`;
  try {
    await navigator.clipboard.writeText(lien);
    bouton.textContent = 'Lien copié ✓';
  } catch {
    window.prompt('Copiez le lien de création de carte :', lien);
  }
  window.setTimeout(() => { bouton.textContent = 'Copier le lien client'; }, 2600);
}

function libelleStatutParrainage(statut) {
  return {
    pending: 'En attente',
    validated: 'Validé',
    rejected: 'Refusé'
  }[statut] || statut;
}

function afficherParrainage() {
  const parrainage = donneesTableau.parrainage;
  if (!parrainage) return;

  const stats = parrainage.statistiques;
  const reglages = parrainage.reglages;
  const indisponible = Boolean(parrainage.indisponible);
  $('#statFilleuls').textContent = stats.clients_acquis;
  $('#statParrainagesAttente').textContent = stats.en_attente;
  $('#statPointsParrainage').textContent = stats.points_distribues;
  $('#statAmbassadeurs').textContent = stats.codes_actifs;
  $('#parrainageActif').checked = reglages.enabled;
  $('#pointsParrain').value = reglages.sponsor_points;
  $('#pointsFilleul').value = reglages.referee_points;
  $('#parrainageActif').disabled = indisponible;
  $('#pointsParrain').disabled = indisponible;
  $('#pointsFilleul').disabled = indisponible;
  $('#enregistrerParrainage').disabled = indisponible;
  if (indisponible) {
    afficherMessage(
      $('#messageParrainage'),
      'Activation serveur en cours. Les autres fonctions restent disponibles.',
      'erreur'
    );
  }

  const invitations = parrainage.invitations;
  $('#resumeParrainage').textContent = `${invitations.length} invitation${invitations.length > 1 ? 's' : ''}`;
  $('#tableParrainages').innerHTML = invitations.map(invitation => `
    <tr>
      <td><div class="client-cell"><span class="avatar-client">${echapper(initiales(invitation.parrain))}</span><strong>${echapper(invitation.parrain)}</strong></div></td>
      <td><strong>${echapper(invitation.filleul)}</strong></td>
      <td><span class="code-parrainage">${echapper(invitation.code)}</span></td>
      <td>${formaterDate(invitation.validated_at || invitation.created_at, Boolean(invitation.validated_at))}</td>
      <td>${invitation.statut === 'validated' ? `+${Number(invitation.points_parrain)} / +${Number(invitation.points_filleul)} pts` : 'Après le premier scan'}</td>
      <td><span class="statut ${echapper(invitation.statut)}">${echapper(libelleStatutParrainage(invitation.statut))}</span></td>
    </tr>`).join('');
  $('#aucunParrainage').style.display = invitations.length ? 'none' : 'block';
  const codes = parrainage.codes || [];
  $('#resumeCodesParrainage').textContent = `${codes.length} code${codes.length > 1 ? 's' : ''}`;
  $('#tableCodesParrainage').innerHTML = codes.map(ligne => {
    const client = ligne.client || {};
    return `<tr><td><strong>${echapper(client.nom || 'Client supprimé')}</strong></td><td>${echapper(client.email || client.telephone || '-')}</td><td><button type="button" class="code-parrainage" data-copier-code="${echapper(ligne.code)}">${echapper(ligne.code)}</button></td><td>${Number(client.points || 0)} pts</td><td>${formaterDate(ligne.created_at)}</td></tr>`;
  }).join('');
  $('#aucunCodeParrainage').style.display = codes.length ? 'none' : 'block';
  document.querySelectorAll('[data-copier-code]').forEach(bouton => bouton.addEventListener('click', async () => {
    await navigator.clipboard.writeText(bouton.dataset.copierCode);
    afficherMessage($('#messageParrainage'), 'Code copié.', 'succes');
  }));
}

async function enregistrerParrainage() {
  const bouton = $('#enregistrerParrainage');
  bouton.disabled = true;
  afficherMessage($('#messageParrainage'), 'Enregistrement...');

  try {
    const donnees = await api(`/api/restaurateur/${encodeURIComponent(slug)}/parrainage`, {
      method: 'PUT',
      body: JSON.stringify({
        enabled: $('#parrainageActif').checked,
        sponsor_points: Number($('#pointsParrain').value),
        referee_points: Number($('#pointsFilleul').value)
      })
    });
    donneesTableau.parrainage.reglages = donnees.reglages;
    afficherMessage($('#messageParrainage'), 'Programme enregistré.', 'succes');
  } catch (erreur) {
    afficherMessage($('#messageParrainage'), erreur.message, 'erreur');
  } finally {
    bouton.disabled = false;
  }
}

function libelleAlerteFraude(type) {
  return {
    duplicate_scan: 'Double scan immédiat',
    daily_scan_limit: 'Trop de scans dans la journée',
    points_per_scan_limit: 'Montant trop élevé par scan',
    daily_points_limit: 'Trop de points dans la journée'
  }[type] || type;
}

function afficherAntiFraude() {
  const antiFraude = donneesTableau.anti_fraude;
  if (!antiFraude) return;

  const stats = antiFraude.statistiques;
  const reglages = antiFraude.reglages;
  $('#statScansProteges').textContent = stats.scans_proteges;
  $('#statBloquesAujourdhui').textContent = stats.bloques_aujourdhui;
  $('#statAlertes7j').textContent = stats.alertes_7j;
  $('#statAlertesCritiques').textContent = stats.critiques_a_traiter;
  $('#antiFraudeActif').checked = reglages.enabled;
  $('#delaiAntiFraude').value = reglages.cooldown_minutes;
  $('#maxScansJour').value = reglages.max_scans_per_day;
  $('#maxPointsScan').value = reglages.max_points_per_scan;
  $('#maxPointsJour').value = reglages.max_points_per_day;

  const alertes = antiFraude.alertes || [];
  $('#resumeAlertesFraude').textContent = `${alertes.length} alerte${alertes.length > 1 ? 's' : ''}`;
  $('#tableAlertesFraude').innerHTML = alertes.map(alerte => `
    <tr>
      <td><div class="client-cell"><span class="avatar-client">${echapper(initiales(alerte.client))}</span><strong>${echapper(alerte.client)}</strong></div></td>
      <td><strong>${echapper(libelleAlerteFraude(alerte.type))}</strong></td>
      <td>${formaterDate(alerte.date, true)}</td>
      <td><span class="points-badge">${Number(alerte.points_tentes)} pts</span></td>
      <td><span class="risque ${echapper(alerte.gravite)}">${alerte.gravite === 'high' ? 'Important' : 'Modéré'}</span></td>
      <td>${alerte.statut === 'new'
        ? `<button class="bouton-table" data-traiter-alerte="${echapper(alerte.id)}">Marquer vérifiée</button>`
        : '<span class="statut validated">Vérifiée</span>'}</td>
    </tr>`).join('');
  $('#aucuneAlerteFraude').style.display = alertes.length ? 'none' : 'block';
}

async function enregistrerAntiFraude() {
  const bouton = $('#enregistrerAntiFraude');
  bouton.disabled = true;
  afficherMessage($('#messageAntiFraude'), 'Enregistrement...');

  try {
    const donnees = await api(`/api/restaurateur/${encodeURIComponent(slug)}/anti-fraude`, {
      method: 'PUT',
      body: JSON.stringify({
        enabled: $('#antiFraudeActif').checked,
        cooldown_minutes: Number($('#delaiAntiFraude').value),
        max_scans_per_day: Number($('#maxScansJour').value),
        max_points_per_scan: Number($('#maxPointsScan').value),
        max_points_per_day: Number($('#maxPointsJour').value)
      })
    });
    donneesTableau.anti_fraude.reglages = donnees.reglages;
    afficherMessage($('#messageAntiFraude'), 'Protection enregistrée.', 'succes');
  } catch (erreur) {
    afficherMessage($('#messageAntiFraude'), erreur.message, 'erreur');
  } finally {
    bouton.disabled = false;
  }
}

async function traiterAlerteFraude(alerteId, bouton) {
  bouton.disabled = true;
  try {
    await api(
      `/api/restaurateur/${encodeURIComponent(slug)}/anti-fraude/${encodeURIComponent(alerteId)}/traiter`,
      { method: 'POST', body: JSON.stringify({ statut: 'reviewed' }) }
    );
    await actualiserTableau(true);
  } catch (erreur) {
    afficherMessage($('#messageAntiFraude'), erreur.message, 'erreur');
    bouton.disabled = false;
  }
}

function bornerPourcentage(valeur) {
  return Math.max(0, Math.min(Number(valeur || 0), 100));
}

function dessinerGraphiqueEvolution(evolution) {
  const svg = $('#graphiqueEvolution');
  if (!evolution?.length) {
    svg.innerHTML = '<text x="380" y="130" text-anchor="middle" fill="#817887" font-size="13">Aucune activité sur cette période</text>';
    return;
  }

  const largeur = 760;
  const hauteur = 260;
  const margeX = 34;
  const margeY = 28;
  const largeurUtile = largeur - margeX * 2;
  const hauteurUtile = hauteur - margeY * 2;
  const maximum = Math.max(1, ...evolution.flatMap(jour => [Number(jour.scans), Number(jour.inscriptions)]));
  const x = index => margeX + (evolution.length === 1 ? 0 : index * largeurUtile / (evolution.length - 1));
  const y = valeur => hauteur - margeY - Number(valeur || 0) * hauteurUtile / maximum;
  const chemin = cle => evolution.map((jour, index) =>
    `${index ? 'L' : 'M'} ${x(index).toFixed(1)} ${y(jour[cle]).toFixed(1)}`
  ).join(' ');
  const indexEtiquettes = [...new Set([0, Math.floor((evolution.length - 1) / 2), evolution.length - 1])];
  const lignes = [0, .25, .5, .75, 1].map(proportion => {
    const positionY = margeY + hauteurUtile * proportion;
    const valeur = Math.round(maximum * (1 - proportion));
    return `<line x1="${margeX}" y1="${positionY}" x2="${largeur - margeX}" y2="${positionY}" stroke="#eee9f1" stroke-width="1"/><text x="${margeX - 8}" y="${positionY + 4}" text-anchor="end" fill="#9a919f" font-size="9">${valeur}</text>`;
  }).join('');
  const etiquettes = indexEtiquettes.map(index => {
    const date = new Date(`${evolution[index].date}T12:00:00`);
    const libelle = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' }).format(date);
    return `<text x="${x(index)}" y="${hauteur - 7}" text-anchor="middle" fill="#9a919f" font-size="9">${echapper(libelle)}</text>`;
  }).join('');

  svg.innerHTML = `${lignes}<path d="${chemin('scans')}" fill="none" stroke="#7a52d6" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="${chemin('inscriptions')}" fill="none" stroke="#22a978" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${etiquettes}`;
}

function afficherStatistiques() {
  const statistiques = donneesTableau.statistiques_detaillees;
  if (!statistiques) return;

  const indicateurs = statistiques.indicateurs || {};
  const wallets = statistiques.wallets || {};
  $('#periodeStatistiques').value = String(statistiques.periode_jours || 30);
  $('#statNouveauxClients').textContent = Number(indicateurs.nouveaux_clients || 0);
  $('#statVisites').textContent = Number(indicateurs.scans || 0);
  $('#statClientsActifsDetail').textContent = Number(indicateurs.clients_actifs || 0);
  $('#statPointsDistribues').textContent = Number(indicateurs.points_distribues || 0);
  $('#tauxRetour').textContent = `${Number(indicateurs.taux_retour || 0)}%`;
  $('#visitesParClient').textContent = Number(indicateurs.visites_par_client_actif || 0).toLocaleString('fr-FR');
  $('#conversionParrainage').textContent = `${Number(indicateurs.conversion_parrainage || 0)}%`;

  const totalClients = Math.max(0, Number(indicateurs.clients_total || 0));
  const adoptionApple = totalClients ? Math.round(Number(wallets.apple || 0) * 100 / totalClients) : 0;
  $('#adoptionApple').textContent = `${adoptionApple}%`;
  $('#jaugeVisites').style.width = `${bornerPourcentage(Number(indicateurs.visites_par_client_actif || 0) * 10)}%`;
  $('#jaugeParrainage').style.width = `${bornerPourcentage(indicateurs.conversion_parrainage)}%`;
  $('#jaugeApple').style.width = `${bornerPourcentage(adoptionApple)}%`;
  $('#anneauRetour').style.setProperty('--score', `${bornerPourcentage(indicateurs.taux_retour) * 3.6}deg`);
  $('#walletAppleDetail').textContent = Number(wallets.apple || 0);
  $('#walletGoogleDetail').textContent = Number(wallets.google || 0);

  dessinerGraphiqueEvolution(statistiques.evolution || []);

  const jours = statistiques.jours_semaine || [];
  const maximumJour = Math.max(1, ...jours.map(jour => Number(jour.scans || 0)));
  $('#barresJours').innerHTML = jours.map(jour => `
    <div class="barre-jour"><span>${echapper(jour.jour)}</span><div><i style="width:${Number(jour.scans || 0) * 100 / maximumJour}%"></i></div><strong>${Number(jour.scans || 0)}</strong></div>`).join('');

  const topClients = statistiques.top_clients || [];
  $('#resumeTopClients').textContent = `${topClients.length} client${topClients.length > 1 ? 's' : ''}`;
  $('#tableTopClients').innerHTML = topClients.map(client => {
    const visites = Number(client.visites || 0);
    const profil = visites >= 5 ? 'Ambassadeur' : visites >= 2 ? 'Fidèle' : 'Nouveau';
    return `<tr><td><div class="client-cell"><span class="avatar-client">${echapper(initiales(client.nom))}</span><strong>${echapper(client.nom)}</strong></div></td><td><strong>${visites}</strong> passages</td><td><span class="points-badge">${Number(client.points_gagnes || 0)} pts</span></td><td>${formaterDate(client.derniere_visite, true)}</td><td><span class="profil-client ${profil.toLowerCase()}">${profil}</span></td></tr>`;
  }).join('');
  $('#aucunTopClient').style.display = topClients.length ? 'none' : 'block';
}

async function chargerStatistiques() {
  const selecteur = $('#periodeStatistiques');
  selecteur.disabled = true;
  try {
    const donnees = await api(
      `/api/restaurateur/${encodeURIComponent(slug)}/statistiques?jours=${encodeURIComponent(selecteur.value)}`
    );
    donneesTableau.statistiques_detaillees = donnees.statistiques;
    afficherStatistiques();
  } catch (erreur) {
    window.alert(erreur.message);
  } finally {
    selecteur.disabled = false;
  }
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
      <td><button class="bouton-table" data-supprimer-client="${echapper(client.id)}" title="Supprimer ce client">Supprimer</button></td>
    </tr>`).join('');
  $('#aucunClient').style.display = filtres.length ? 'none' : 'block';
}

async function supprimerClient(id, nom) {
  if (!confirm(`Supprimer « ${nom} » ? Son historique de points et de parrainage sera définitivement perdu. Sa carte restera installée dans son téléphone mais ne sera plus liée à votre restaurant.`)) return;
  try {
    await api(`/api/restaurateur/${encodeURIComponent(slug)}/clients/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await actualiserTableau(true);
    afficherMessage($('#messageEnvoi'), `« ${nom} » a été supprimé.`, 'succes');
  } catch (erreur) {
    window.alert(erreur.message);
  }
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

function attendre(duree) {
  return new Promise(resolve => setTimeout(resolve, duree));
}

async function envoyerCampagneAvecReprise(corps, campagneId) {
  const url = `/api/restaurateur/${encodeURIComponent(slug)}/notifications`;

  try {
    return await api(url, { method: 'POST', body: JSON.stringify(corps) });
  } catch (premiereErreur) {
    const erreurReseau = /failed to fetch|networkerror|connexion/i.test(
      premiereErreur.message
    );
    if (!erreurReseau) throw premiereErreur;

    await attendre(1200);

    try {
      return await api(url, { method: 'POST', body: JSON.stringify(corps) });
    } catch (secondeErreur) {
      try {
        const verification = await api(
          `/api/restaurateur/${encodeURIComponent(slug)}/tableau-de-bord`
        );
        const campagneTrouvee = verification.notifications.find(
          campagne => campagne.id === campagneId
        );
        if (campagneTrouvee) {
          donneesTableau = verification;
          return { succes: true, campagne: campagneTrouvee };
        }
      } catch {
        // Le message clair ci-dessous remplace l'erreur technique du navigateur.
      }

      throw new Error(
        'La connexion au serveur a été interrompue. Aucun nouvel envoi ne sera relancé automatiquement.'
      );
    }
  }
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
    const campagneId = crypto.randomUUID();
    await envoyerCampagneAvecReprise(
      {
        request_id: campagneId,
        titre,
        message,
        plateforme,
        ...(estTest ? { client_id_test: $('#clientTest').value } : {})
      },
      campagneId
    );
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

function elementAsset(plateforme, id) {
  return document.querySelector(`.asset-wallet[data-asset="${plateforme}.${id}"]`);
}

function specificationAsset(plateforme, id) {
  return walletSpecifications?.[plateforme]?.[id] || null;
}

function valeurAsset(plateforme, id) {
  const element = elementAsset(plateforme, id);
  return element ? element.querySelector('.asset-url').value.trim() : '';
}

function actualiserApercuMiniatureAsset(element) {
  const valeur = element.querySelector('.asset-url').value.trim();
  const cadre = element.querySelector('.asset-apercu-miniature');
  const image = cadre.querySelector('img');
  image.src = valeur;
  image.hidden = !valeur;
  cadre.classList.toggle('avec-image', Boolean(valeur));
}

function definirValeurAsset(element, valeur) {
  element.querySelector('.asset-url').value = valeur;
  actualiserApercuMiniatureAsset(element);
}

function remplirDesign() {
  const preset = document.querySelector(`[name="preset"][value="${restaurant.apple_color_preset}"]`);
  if (preset) preset.checked = true;
  const format = restaurant.wallet_barcode_format === 'QR_CODE' ? 'QR_CODE' : 'CODE_128';
  const choixFormat = document.querySelector(`[name="walletBarcodeFormat"][value="${format}"]`);
  if (choixFormat) choixFormat.checked = true;

  const correspondancesCommunes = {
    walletPointsLabel: 'apple_points_label',
    walletCardLabel: 'apple_card_label',
    walletProgramName: 'apple_program_name',
    walletRewardText: 'apple_reward_text',
    customColor: 'apple_custom_color',
    appleLogoText: 'apple_logo_text',
    appleTerms: 'apple_terms'
  };
  for (const [id, champ] of Object.entries(correspondancesCommunes)) $(`#${id}`).value = restaurant[champ] || '';
  $('#customColorPicker').value = /^#[0-9a-f]{6}$/i.test(restaurant.apple_custom_color || '')
    ? restaurant.apple_custom_color : couleursWallet[restaurant.apple_color_preset] || '#17171D';

  const correspondancesAssets = {
    'apple.logo': 'apple_logo_url',
    'apple.icone': 'apple_icon_url',
    'apple.banniere': 'apple_strip_url',
    'google.logoRond': 'google_program_logo_url',
    'google.logoLarge': 'google_wide_logo_url',
    'google.heroImage': 'google_hero_image_url'
  };
  for (const [cle, champ] of Object.entries(correspondancesAssets)) {
    const [plateforme, id] = cle.split('.');
    const element = elementAsset(plateforme, id);
    if (element) definirValeurAsset(element, restaurant[champ] || '');
  }

  const messagePro = restaurant.pro_disponible
    ? 'Toutes les options professionnelles sont disponibles'
    : 'Abonnement WalletWallet Pro requis';
  $('#zoneProApple').classList.toggle('verrouille', !restaurant.pro_autorise);
  $('#zoneProGoogle').classList.toggle('verrouille', !restaurant.pro_autorise);
  $('#messageProApple').textContent = messagePro;
  $('#messageProGoogle').textContent = messagePro;

  actualiserApercuWallet();
  actualiserApercuGoogleWallet();
}

function actualiserApercuWallet() {
  const preset = document.querySelector('[name="preset"]:checked')?.value || 'dark';
  const exacte = $('#customColor').value;
  $('#wallet').style.background = restaurant?.pro_autorise && /^#[0-9a-f]{6}$/i.test(exacte)
    ? exacte : couleursWallet[preset];
  $('#previewLogo').textContent = $('#appleLogoText').value || 'Bravocard';
  $('#previewPointsLabel').textContent = $('#walletPointsLabel').value || 'POINTS SUR 100';
  $('#previewCardLabel').textContent = $('#walletCardLabel').value || 'FIDÉLITÉ';
  $('#previewProgramme').textContent = $('#walletProgramName').value || 'Carte fidélité';
  $('#previewRecompense').textContent = $('#walletRewardText').value || 'Récompense à débloquer';
  const logo = valeurAsset('apple', 'logo');
  const banniere = valeurAsset('apple', 'banniere');
  const imageLogo = $('#previewLogoImage');
  imageLogo.src = logo;
  imageLogo.classList.toggle('visible', Boolean(logo));
  const zoneBanniere = $('#previewBanniere');
  zoneBanniere.style.backgroundImage = banniere ? `url("${banniere.replace(/"/g, '%22')}")` : '';
  zoneBanniere.classList.toggle('visible', Boolean(banniere));
  $('#wallet').classList.toggle('format-qr', document.querySelector('[name="walletBarcodeFormat"]:checked')?.value === 'QR_CODE');
  actualiserZonesSecurite();
}

function actualiserApercuGoogleWallet() {
  const preset = document.querySelector('[name="preset"]:checked')?.value || 'dark';
  const exacte = $('#customColor').value;
  $('#walletGoogle').style.background = restaurant?.pro_autorise && /^#[0-9a-f]{6}$/i.test(exacte)
    ? exacte : couleursWallet[preset];
  $('#googlePreviewProgramme').textContent = $('#walletProgramName').value || 'Carte fidélité';
  $('#googlePreviewPointsLabel').textContent = $('#walletPointsLabel').value || 'POINTS SUR 100';
  $('#googlePreviewCardLabel').textContent = $('#walletCardLabel').value || 'FIDÉLITÉ';

  const logoRond = valeurAsset('google', 'logoRond');
  const logoLarge = valeurAsset('google', 'logoLarge');
  const hero = valeurAsset('google', 'heroImage');

  const imageLogoRond = $('#googlePreviewLogoRond');
  imageLogoRond.src = logoRond || '/logo-bravocard-encadre.png';
  imageLogoRond.hidden = false;

  const imageLogoLarge = $('#googlePreviewLogoLarge');
  imageLogoLarge.src = logoLarge;
  imageLogoLarge.hidden = !logoLarge;
  imageLogoLarge.classList.toggle('visible', Boolean(logoLarge));

  const zoneHero = $('#googlePreviewHero');
  zoneHero.style.backgroundImage = hero ? `url("${hero.replace(/"/g, '%22')}")` : '';
  zoneHero.hidden = !hero;
  zoneHero.classList.toggle('visible', Boolean(hero));

  $('#walletGoogle').classList.toggle('format-qr', document.querySelector('[name="walletBarcodeFormat"]:checked')?.value === 'QR_CODE');
  actualiserZonesSecurite();
}

function genererZonesReperees(conteneurWallet, definitions) {
  const overlay = conteneurWallet?.querySelector('.wallet-zones-overlay');
  if (!overlay) return;
  overlay.innerHTML = '';
  overlay.classList.toggle('actif', walletZonesSecuriteActives);
  if (!walletZonesSecuriteActives) return;
  const cadre = conteneurWallet.getBoundingClientRect();
  definitions.forEach(({ selecteur, type, label, cercle }) => {
    const cible = conteneurWallet.querySelector(selecteur);
    if (!cible) return;
    const rect = cible.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const zone = document.createElement('div');
    zone.className = `zone-reperee ${type}`;
    zone.style.left = `${rect.left - cadre.left}px`;
    zone.style.top = `${rect.top - cadre.top}px`;
    zone.style.width = `${rect.width}px`;
    zone.style.height = `${rect.height}px`;
    if (cercle) zone.style.borderRadius = '50%';
    const texte = document.createElement('small');
    texte.textContent = label;
    zone.appendChild(texte);
    overlay.appendChild(zone);
  });
}

function actualiserZonesSecurite() {
  genererZonesReperees($('#wallet'), [
    { selecteur: '.preview-logo-zone', type: 'zone-image', label: 'Logo' },
    { selecteur: '#previewBanniere', type: 'zone-image', label: 'Bande décorative' },
    { selecteur: '.wallet-principal', type: 'zone-texte', label: 'Champ principal' },
    { selecteur: '.wallet-bas>div:first-child', type: 'zone-texte', label: 'Champs secondaires' },
    { selecteur: '.codebarres', type: 'zone-code', label: 'Code / QR' }
  ]);
  genererZonesReperees($('#walletGoogle'), [
    { selecteur: '.google-logo-rond', type: 'zone-image', label: 'Logo rond', cercle: true },
    { selecteur: '.google-logo-large', type: 'zone-image', label: 'Logo large' },
    { selecteur: '.google-hero', type: 'zone-image', label: 'Image Hero' },
    { selecteur: '.google-points', type: 'zone-texte', label: 'Points' },
    { selecteur: '.google-modules', type: 'zone-texte', label: 'Champs texte' },
    { selecteur: '.codebarres', type: 'zone-code', label: 'Code / QR' }
  ]);
  if (walletZonesSecuriteActives) {
    const logoRond = $('#walletGoogle .google-logo-rond');
    const overlayGoogle = $('#walletGoogle .wallet-zones-overlay');
    if (logoRond && overlayGoogle && logoRond.getBoundingClientRect().width > 0) {
      const rectLogo = logoRond.getBoundingClientRect();
      const rectCadre = $('#walletGoogle').getBoundingClientRect();
      const marge = rectLogo.width * 0.15;
      const zoneSecurite = document.createElement('div');
      zoneSecurite.className = 'zone-reperee zone-securite';
      zoneSecurite.style.left = `${rectLogo.left - rectCadre.left + marge}px`;
      zoneSecurite.style.top = `${rectLogo.top - rectCadre.top + marge}px`;
      zoneSecurite.style.width = `${rectLogo.width - marge * 2}px`;
      zoneSecurite.style.height = `${rectLogo.height - marge * 2}px`;
      const texte = document.createElement('small');
      texte.textContent = 'Zone sûre';
      zoneSecurite.appendChild(texte);
      overlayGoogle.appendChild(zoneSecurite);
    }
  }
  $('#walletLegendeZones').classList.toggle('visible', walletZonesSecuriteActives);
}

function basculerOngletWallet(plateforme) {
  walletPlateformeActive = plateforme === 'google' ? 'google' : 'apple';
  document.querySelectorAll('.wallet-onglet').forEach(bouton => {
    const actif = bouton.dataset.plateformeWallet === walletPlateformeActive;
    bouton.classList.toggle('actif', actif);
    bouton.setAttribute('aria-selected', String(actif));
  });
  $('#walletPanneauApple').classList.toggle('masque', walletPlateformeActive !== 'apple');
  $('#walletPanneauGoogle').classList.toggle('masque', walletPlateformeActive !== 'google');
  $('#apercuApple').classList.toggle('masque', walletPlateformeActive !== 'apple');
  $('#apercuGoogle').classList.toggle('masque', walletPlateformeActive !== 'google');
  $('#walletLegende').textContent = walletPlateformeActive === 'google'
    ? 'Aperçu indicatif Google Wallet · Google peut ajuster automatiquement certains espacements selon l’appareil.'
    : 'Aperçu indicatif Apple Wallet · l’apparence exacte peut légèrement varier selon la version d’iOS.';
  actualiserZonesSecurite();
}

const LIBELLES_STATUT_ASSET = {
  conforme: 'Conforme',
  acceptable_avec_recadrage: 'Acceptable',
  trop_petite: 'Trop petite',
  format_non_supporte: 'Format invalide',
  fichier_trop_lourd: 'Trop lourd'
};

async function chargerSpecificationsWallet() {
  const donnees = await api('/api/wallet-asset-specifications');
  walletSpecifications = donnees.specifications;
  initialiserAssetsWallet();
}

function initialiserAssetsWallet() {
  if (!walletSpecifications) return;
  document.querySelectorAll('.asset-wallet[data-asset]').forEach(element => {
    const [plateforme, id] = element.dataset.asset.split('.');
    const spec = specificationAsset(plateforme, id);
    if (!spec) return;
    element.querySelector('.asset-dimensions').textContent =
      `Dimensions conseillées : ${spec.largeurRecommandee} × ${spec.hauteurRecommandee} px · Ratio ${spec.ratio.toFixed(2)}:1`;
    const badge = element.querySelector('.asset-statut');
    badge.dataset.requisDefaut = String(spec.requis);
    if (!badge.dataset.statutActif) badge.textContent = spec.requis ? 'Requis' : 'Facultatif';
    const zoneMessage = element.querySelector('.asset-message');
    if (!zoneMessage.textContent.trim()) zoneMessage.textContent = spec.description;
  });
}

function afficherStatutAsset(assetElement, statut, message) {
  const badge = assetElement.querySelector('.asset-statut');
  Object.keys(LIBELLES_STATUT_ASSET).forEach(cle => badge.classList.remove(cle));
  badge.textContent = LIBELLES_STATUT_ASSET[statut] || (badge.dataset.requisDefaut === 'true' ? 'Requis' : 'Facultatif');
  if (statut) {
    badge.classList.add(statut);
    badge.dataset.statutActif = 'true';
  }
  const zoneMessage = assetElement.querySelector('.asset-message');
  zoneMessage.textContent = message || zoneMessage.textContent;
  zoneMessage.classList.toggle('erreur', statut === 'trop_petite' || statut === 'format_non_supporte' || statut === 'fichier_trop_lourd');
}

function gererSelectionFichierAsset(evenement, assetElement) {
  const fichier = evenement.target.files[0];
  if (!fichier) return;
  if (fichier.type !== 'image/png') {
    afficherStatutAsset(assetElement, 'format_non_supporte', 'Choisissez un fichier PNG.');
    evenement.target.value = '';
    return;
  }
  const lecteur = new FileReader();
  lecteur.onload = () => ouvrirRecadrage(lecteur.result, assetElement);
  lecteur.readAsDataURL(fichier);
  evenement.target.value = '';
}

function ouvrirRecadrage(dataUrl, assetElement) {
  const [plateforme, id] = assetElement.dataset.asset.split('.');
  const spec = specificationAsset(plateforme, id);
  if (!spec) return;
  walletRecadrage.assetElement = assetElement;
  walletRecadrage.plateforme = plateforme;
  walletRecadrage.id = id;
  $('#recadrageTitre').textContent = `Ajuster : ${spec.nom} (${plateforme === 'google' ? 'Google Wallet' : 'Apple Wallet'})`;
  $('#recadrageAide').textContent =
    `Dimensions conseillées : ${spec.largeurRecommandee} × ${spec.hauteurRecommandee} px · Ratio ${spec.ratio.toFixed(2)}:1.`;
  $('#recadrageFond').classList.add('visible');
  const image = $('#recadrageImage');
  if (walletRecadrage.cropper) {
    walletRecadrage.cropper.destroy();
    walletRecadrage.cropper = null;
  }
  image.src = dataUrl;
  image.onload = () => {
    walletRecadrage.cropper = new Cropper(image, {
      aspectRatio: spec.ratio,
      viewMode: 1,
      autoCropArea: 1,
      background: true,
      responsive: true
    });
    document.querySelectorAll('[data-mode-ajustement]').forEach(bouton =>
      bouton.classList.toggle('actif', bouton.dataset.modeAjustement === 'centrer')
    );
  };
}

function fermerRecadrage() {
  if (walletRecadrage.cropper) {
    walletRecadrage.cropper.destroy();
    walletRecadrage.cropper = null;
  }
  walletRecadrage.assetElement = null;
  $('#recadrageFond').classList.remove('visible');
}

function appliquerModeAjustement(mode) {
  if (!walletRecadrage.cropper) return;
  document.querySelectorAll('[data-mode-ajustement]').forEach(bouton =>
    bouton.classList.toggle('actif', bouton.dataset.modeAjustement === mode)
  );
  walletRecadrage.cropper.reset();
  // "Couvrir" rapproche l'image pour remplir tout le cadre (quitte a couper les
  // bords), "contenir" l'eloigne pour tout montrer (bords transparents visibles
  // grace a l'option background:true), "centrer" reste au cadrage automatique.
  if (mode === 'couvrir') walletRecadrage.cropper.zoom(0.2);
  if (mode === 'contenir') walletRecadrage.cropper.zoom(-0.2);
}

async function validerRecadrage() {
  const assetElement = walletRecadrage.assetElement;
  const plateforme = walletRecadrage.plateforme;
  const id = walletRecadrage.id;
  if (!assetElement || !walletRecadrage.cropper) return;
  const spec = specificationAsset(plateforme, id);
  const bouton = $('#validerRecadrage');
  bouton.disabled = true;
  try {
    const canvas = walletRecadrage.cropper.getCroppedCanvas({
      width: spec.largeurRecommandee,
      height: spec.hauteurRecommandee
    });
    const dataUrl = canvas.toDataURL('image/png');
    afficherStatutAsset(assetElement, null, 'Import en cours…');
    const donnees = await api(`/api/design/${encodeURIComponent(slug)}/image`, {
      method: 'POST',
      body: JSON.stringify({ plateforme, type: id, image_data: dataUrl })
    });
    definirValeurAsset(assetElement, donnees.url);
    afficherStatutAsset(assetElement, donnees.statut, donnees.message);
    assetElement.querySelector('.asset-supprimer').hidden = false;
    actualiserApercuWallet();
    actualiserApercuGoogleWallet();
    fermerRecadrage();
    afficherMessage($('#messageDesign'), 'Image importée. Enregistrez pour publier ce changement.', 'succes');
  } catch (erreur) {
    afficherStatutAsset(assetElement, 'format_non_supporte', erreur.message);
  } finally {
    bouton.disabled = false;
  }
}

function supprimerAsset(assetElement) {
  definirValeurAsset(assetElement, '');
  assetElement.querySelector('.asset-supprimer').hidden = true;
  afficherStatutAsset(assetElement, null, null);
  actualiserApercuWallet();
  actualiserApercuGoogleWallet();
}

const modelesWallet = {
  signature: { preset: 'dark', color: '#17171D', points: 'POINTS', card: 'MEMBRE', program: 'Carte privilège', reward: 'Votre récompense vous attend' },
  violet: { preset: 'purple', color: '#2B174A', points: 'POINTS', card: 'CLUB', program: 'Le Club Maison', reward: 'Un avantage à 100 points' },
  foret: { preset: 'green', color: '#0E3B2E', points: 'POINTS', card: 'FIDÉLITÉ', program: 'Les habitués', reward: 'Une attention à débloquer' },
  neon: { preset: 'blue', color: '#071049', points: 'CRÉDITS', card: 'VIP', program: 'Night rewards', reward: 'Votre surprise approche', strip: '/BANNER%20V3.png', icon: '/avatar-bravocard.png', logo: '/logo-bravocard-encadre.png' },
  bistrot: { preset: 'orange', color: '#7B3023', points: 'POINTS', card: 'TABLE', program: 'Les bons vivants', reward: 'Votre prochaine attention maison' },
  azur: { preset: 'blue', color: '#07547A', points: 'SOLEILS', card: 'CLUB', program: 'Escapade gourmande', reward: 'Une parenthèse offerte à 100 soleils' },
  patissier: { preset: 'red', color: '#74324B', points: 'DOUCEURS', card: 'PRIVILÈGE', program: 'Le salon des habitués', reward: 'Une douceur maison vous attend' }
};

function appliquerModeleWallet(nom) {
  const modele = modelesWallet[nom];
  if (!modele) return;
  document.querySelector(`[name="preset"][value="${modele.preset}"]`).checked = true;
  $('#customColor').value = modele.color;
  $('#customColorPicker').value = modele.color;
  $('#walletPointsLabel').value = modele.points;
  $('#walletCardLabel').value = modele.card;
  $('#walletProgramName').value = modele.program;
  $('#walletRewardText').value = modele.reward;
  if (modele.strip) definirValeurAsset(elementAsset('apple', 'banniere'), `${window.location.origin}${modele.strip}`);
  if (modele.icon) definirValeurAsset(elementAsset('apple', 'icone'), `${window.location.origin}${modele.icon}`);
  if (modele.logo) definirValeurAsset(elementAsset('apple', 'logo'), `${window.location.origin}${modele.logo}`);
  document.querySelectorAll('[data-modele-wallet]').forEach(bouton =>
    bouton.classList.toggle('actif', bouton.dataset.modeleWallet === nom)
  );
  actualiserApercuWallet();
  actualiserApercuGoogleWallet();
}

async function enregistrerDesign() {
  const bouton = $('#enregistrerDesign');
  bouton.disabled = true;
  afficherMessage($('#messageDesign'), 'Enregistrement...');
  const corps = {
    wallet_barcode_format: document.querySelector('[name="walletBarcodeFormat"]:checked')?.value || 'CODE_128',
    apple_color_preset: document.querySelector('[name="preset"]:checked').value,
    apple_custom_color: $('#customColor').value,
    apple_points_label: $('#walletPointsLabel').value,
    apple_card_label: $('#walletCardLabel').value,
    apple_program_name: $('#walletProgramName').value,
    apple_reward_text: $('#walletRewardText').value,
    apple_logo_text: $('#appleLogoText').value,
    apple_terms: $('#appleTerms').value,
    apple_logo_url: valeurAsset('apple', 'logo'),
    apple_strip_url: valeurAsset('apple', 'banniere'),
    apple_icon_url: valeurAsset('apple', 'icone'),
    google_program_logo_url: valeurAsset('google', 'logoRond'),
    google_wide_logo_url: valeurAsset('google', 'logoLarge'),
    google_hero_image_url: valeurAsset('google', 'heroImage')
  };
  try {
    const donnees = await api(`/api/design/${encodeURIComponent(slug)}`, {
      method: 'PUT', body: JSON.stringify(corps)
    });
    restaurant = donnees.restaurant;
    remplirDesign();
    afficherMessage($('#messageDesign'), donnees.message || 'Design enregistré.', 'succes');
  } catch (erreur) {
    afficherMessage($('#messageDesign'), erreur.message, 'erreur');
  } finally {
    bouton.disabled = false;
  }
}

function afficherSupportsMarketing() {
  if (!supportsMarketing) return;
  const pret = supportsMarketing.statut === 'ready';
  $('#marketingRestaurantNom').textContent = restaurant?.nom || 'Votre restaurant';
  $('#marketingStatut').textContent = pret ? 'Supports prêts' : 'Préparation en cours';
  $('#marketingLien').value = supportsMarketing.lien_public || '';
  if (supportsMarketing.qr_png_url) $('#marketingQrPreview').src = supportsMarketing.qr_png_url;
  $('#marketingSecondaire').hidden = !supportsMarketing.secondaire_disponible;
  $('#lienAvisGoogle').value = supportsMarketing.lien_avis_google || '';
  const liens = [
    ['telechargerFlyer', supportsMarketing.flyer_pdf_url],
    ['telechargerQrPng', supportsMarketing.qr_png_url],
    ['telechargerQrSvg', supportsMarketing.qr_svg_url]
  ];
  liens.forEach(([id, url]) => {
    const element = $(`#${id}`);
    element.href = url || '#';
    element.setAttribute('aria-disabled', url ? 'false' : 'true');
  });
  [
    ['telechargerQrAvisPng', supportsMarketing.secondary_qr_png_url],
    ['telechargerQrAvisSvg', supportsMarketing.secondary_qr_svg_url]
  ].forEach(([id, url]) => {
    const element = $(`#${id}`);
    element.href = url || '#';
    element.setAttribute('aria-disabled', url ? 'false' : 'true');
  });
}

async function enregistrerLienAvis() {
  const bouton = $('#enregistrerLienAvis');
  bouton.disabled = true;
  afficherMessage($('#messageMarketing'), 'Actualisation du second QR code…');
  try {
    const donnees = await api(`/api/restaurateur/${encodeURIComponent(slug)}/marketing`, {
      method: 'PUT', body: JSON.stringify({ lien_avis_google: $('#lienAvisGoogle').value })
    });
    supportsMarketing = donnees.supports;
    afficherSupportsMarketing();
    afficherMessage($('#messageMarketing'), donnees.message, 'succes');
  } catch (erreur) {
    afficherMessage($('#messageMarketing'), erreur.message, 'erreur');
  } finally {
    bouton.disabled = false;
  }
}

async function chargerSupportsMarketing() {
  $('#marketingStatut').textContent = 'Préparation…';
  const donnees = await api(`/api/restaurateur/${encodeURIComponent(slug)}/marketing`);
  supportsMarketing = donnees.supports;
  afficherSupportsMarketing();
}

async function regenererSupportsMarketing() {
  const bouton = $('#regenererSupports');
  bouton.disabled = true;
  afficherMessage($('#messageMarketing'), 'Régénération du QR code et du flyer…');
  try {
    const donnees = await api(`/api/restaurateur/${encodeURIComponent(slug)}/marketing/regenerer`, {
      method: 'POST', body: JSON.stringify({})
    });
    supportsMarketing = donnees.supports;
    afficherSupportsMarketing();
    afficherMessage($('#messageMarketing'), donnees.message, 'succes');
  } catch (erreur) {
    afficherMessage($('#messageMarketing'), erreur.message, 'erreur');
  } finally {
    bouton.disabled = false;
  }
}

async function copierLienMarketing() {
  const lien = $('#marketingLien').value;
  if (!lien) return;
  try {
    await navigator.clipboard.writeText(lien);
  } catch {
    $('#marketingLien').select();
    document.execCommand('copy');
  }
  afficherMessage($('#messageMarketing'), 'Lien copié.', 'succes');
}

function couleurApercuTheme(themeId) {
  const theme = (kitCommunication?.themes || []).find(t => t.id === themeId);
  return theme ? `linear-gradient(145deg, ${theme.primaire}, ${theme.secondaire})` : '#17131f';
}

function afficherPickerGenerateur(conteneurId, items, valeurActuelle, attribut, degrade) {
  $(`#${conteneurId}`).innerHTML = items.map(item => `
    <button type="button" data-${attribut}="${echapper(item.id)}" class="${item.id === valeurActuelle ? 'actif' : ''}">
      <span class="modele-visuel" style="background:${degrade(item)}"></span>
      <strong>${echapper(item.nom)}</strong>
      <small>${echapper(item.description || '')}</small>
    </button>`).join('');
}

function rafraichirPickersGenerateur() {
  if (!kitCommunication) return;
  afficherPickerGenerateur('genListeSupports', kitCommunication.supports, genEtat.support, 'support',
    item => couleurApercuTheme(item.theme_par_defaut));
  afficherPickerGenerateur('genListeThemes',
    kitCommunication.themes.map(theme => ({ ...theme, description: theme.sombre ? 'Fond sombre premium' : 'Fond clair ludique' })),
    genEtat.theme, 'theme', item => `linear-gradient(145deg, ${item.primaire}, ${item.secondaire})`);
  $('#genLigneGagnant').style.display = genEtat.support === 'review-square' ? '' : 'none';
  const estAffichePoster = genEtat.support === 'loyalty-poster-a5';
  $('#genLigneTitreSousTitre').style.display = estAffichePoster ? 'none' : '';
  $('#genBlocPoster').style.display = estAffichePoster ? '' : 'none';
}

function genParametresActuels() {
  return {
    support: genEtat.support,
    theme: genEtat.theme,
    primary_color: $('#genCouleurPrincipale').value,
    secondary_color: $('#genCouleurSecondaire').value,
    title: $('#genTitre').value,
    subtitle: $('#genSousTitre').value,
    always_winner: $('#genToujoursGagnant').checked,
    logo_url: $('#genLogoUrl').value.trim(),
    nombre_tampons: $('#genNombreTampons').value,
    recompense: $('#genRecompense').value,
    citation: $('#genCitation').value
  };
}

function genUrlAvecParametres(chemin) {
  const recherche = new URLSearchParams();
  for (const [cle, valeur] of Object.entries(genParametresActuels())) {
    if (valeur === '' || valeur === null || valeur === undefined) continue;
    recherche.set(cle, valeur);
  }
  return `/api/restaurateur/${encodeURIComponent(slug)}/kit-communication/${chemin}?${recherche.toString()}`;
}

function demanderApercuGenerateur() {
  clearTimeout(genMinuteurApercu);
  genMinuteurApercu = setTimeout(actualiserApercuGenerateur, 350);
}

async function actualiserApercuGenerateur() {
  if (!genEtat.support) return;
  try {
    const donnees = await api(genUrlAvecParametres('apercu'));
    $('#genApercuCadre').innerHTML = donnees.svg;
    $('#genLienNfc').value = donnees.lien_nfc || '';
  } catch (erreur) {
    afficherMessage($('#messageGenerateur'), erreur.message, 'erreur');
  }
}

function choisirSupportGenerateur(supportId) {
  const support = kitCommunication.supports.find(s => s.id === supportId);
  if (!support) return;
  genEtat.support = supportId;
  if (!genEtat.themeChoisiManuellement) genEtat.theme = support.theme_par_defaut;
  $('#genTitre').value = support.titre_par_defaut;
  $('#genSousTitre').value = support.sous_titre_par_defaut;
  $('#genNombreTampons').value = '';
  $('#genRecompense').value = '';
  $('#genCitation').value = '';
  appliquerCouleursTheme(genEtat.theme);
  rafraichirPickersGenerateur();
  demanderApercuGenerateur();
}

function appliquerCouleursTheme(themeId) {
  const theme = kitCommunication.themes.find(t => t.id === themeId);
  if (!theme) return;
  $('#genCouleurPrincipale').value = theme.primaire;
  $('#genCouleurSecondaire').value = theme.secondaire;
}

function choisirThemeGenerateur(themeId) {
  genEtat.theme = themeId;
  genEtat.themeChoisiManuellement = true;
  appliquerCouleursTheme(themeId);
  rafraichirPickersGenerateur();
  demanderApercuGenerateur();
}

async function chargerKitCommunication() {
  const donnees = await api(`/api/restaurateur/${encodeURIComponent(slug)}/kit-communication`);
  kitCommunication = donnees;
  genEtat.support = donnees.supports[0]?.id || null;
  genEtat.theme = donnees.parametres.communication_theme;
  genEtat.themeChoisiManuellement = false;
  // Un <input type="color"> ne peut pas rester "vide" : lui assigner '' le fait
  // retomber sur #000000 côté navigateur. Il faut donc tester la valeur d'origine
  // (venant de l'API) avant affectation, pas la valeur du champ après coup.
  if (donnees.parametres.communication_primary_color && donnees.parametres.communication_secondary_color) {
    $('#genCouleurPrincipale').value = donnees.parametres.communication_primary_color;
    $('#genCouleurSecondaire').value = donnees.parametres.communication_secondary_color;
  } else {
    appliquerCouleursTheme(genEtat.theme);
  }
  $('#genLogoUrl').value = donnees.parametres.communication_logo_url || '';
  $('#genToujoursGagnant').checked = donnees.parametres.always_winner;
  const support = donnees.supports.find(s => s.id === genEtat.support);
  if (support) {
    $('#genTitre').value = support.titre_par_defaut;
    $('#genSousTitre').value = support.sous_titre_par_defaut;
  }
  rafraichirPickersGenerateur();
  demanderApercuGenerateur();
}

async function enregistrerPersonnalisationGenerateur() {
  const bouton = $('#genEnregistrer');
  bouton.disabled = true;
  afficherMessage($('#messageGenerateur'), 'Enregistrement...');
  try {
    const donnees = await api(`/api/restaurateur/${encodeURIComponent(slug)}/kit-communication`, {
      method: 'PUT',
      body: JSON.stringify({
        communication_theme: genEtat.theme,
        communication_primary_color: $('#genCouleurPrincipale').value,
        communication_secondary_color: $('#genCouleurSecondaire').value,
        communication_logo_url: $('#genLogoUrl').value.trim(),
        always_winner: $('#genToujoursGagnant').checked
      })
    });
    afficherMessage($('#messageGenerateur'), donnees.message, 'succes');
  } catch (erreur) {
    afficherMessage($('#messageGenerateur'), erreur.message, 'erreur');
  } finally {
    bouton.disabled = false;
  }
}

async function copierLienNfc() {
  const valeur = $('#genLienNfc').value;
  if (!valeur) return;
  try {
    await navigator.clipboard.writeText(valeur);
  } catch {
    $('#genLienNfc').select();
    document.execCommand('copy');
  }
  afficherMessage($('#messageGenerateur'), 'Lien copié.', 'succes');
}

async function telechargerExportGenerateur(format) {
  if (!genEtat.support) return;
  afficherMessage($('#messageExport'), 'Préparation du fichier...');
  try {
    const reponse = await fetch(`${genUrlAvecParametres('export')}&format=${format}`, { headers: entetes() });
    if (!reponse.ok) {
      const donnees = await reponse.json().catch(() => ({}));
      throw new Error(donnees.erreur || 'Le téléchargement a échoué.');
    }
    const blob = await reponse.blob();
    const entete = reponse.headers.get('Content-Disposition') || '';
    const correspondance = entete.match(/filename="([^"]+)"/);
    const objectUrl = URL.createObjectURL(blob);
    const lienTemporaire = document.createElement('a');
    lienTemporaire.href = objectUrl;
    lienTemporaire.download = correspondance ? correspondance[1] : `bravocard-${genEtat.support}.${format}`;
    document.body.appendChild(lienTemporaire);
    lienTemporaire.click();
    lienTemporaire.remove();
    URL.revokeObjectURL(objectUrl);
    afficherMessage($('#messageExport'), 'Téléchargement lancé.', 'succes');
  } catch (erreur) {
    afficherMessage($('#messageExport'), erreur.message, 'erreur');
  }
}

function libelleRoleCourt(role) {
  return { owner: 'Propriétaire', manager: 'Manager', employee: 'Employé' }[role] || role;
}

async function chargerEquipe() {
  if (!aPermission('team_manage')) return;
  try {
    const donnees = await api(`/api/restaurateur/${encodeURIComponent(slug)}/equipe`);
    const membres = donnees.membres || [];
    $('#resumeEquipe').textContent = `${membres.length} membre${membres.length > 1 ? 's' : ''}`;
    $('#roleMembre').querySelector('option[value="owner"]').hidden = !donnees.peut_nommer_proprietaire;
    $('#tableEquipe').innerHTML = membres.map(membre => {
      const afficherProprietaire = donnees.peut_nommer_proprietaire || membre.role === 'owner';
      const options = ['employee', 'manager', ...(afficherProprietaire ? ['owner'] : [])]
        .map(role => `<option value="${role}" ${membre.role === role ? 'selected' : ''} ${role === 'owner' && !donnees.peut_nommer_proprietaire ? 'disabled' : ''}>${echapper(libelleRoleCourt(role))}</option>`)
        .join('');
      return `<tr data-membership="${Number(membre.id)}">
        <td><div class="client-cell"><span class="avatar-client">${echapper(initiales(membre.full_name))}</span><strong>${echapper(membre.full_name)}</strong></div></td>
        <td>${echapper(membre.email)}</td>
        <td><select class="role-select" data-role-membre>${options}</select></td>
        <td><span class="etat-membre ${membre.active ? 'actif' : 'inactif'}">${membre.active ? 'Actif' : 'Suspendu'}</span></td>
        <td><button class="bouton-table" data-basculer-membre="${membre.active ? 'false' : 'true'}">${membre.active ? 'Suspendre' : 'Réactiver'}</button></td>
      </tr>`;
    }).join('');
    $('#aucunMembre').style.display = membres.length ? 'none' : 'block';
  } catch (erreur) {
    afficherMessage($('#messageEquipe'), erreur.message, 'erreur');
  }
}

async function ajouterMembre() {
  const bouton = $('#ajouterMembre');
  bouton.disabled = true;
  afficherMessage($('#messageEquipe'), 'Création du compte...');
  try {
    const donnees = await api(`/api/restaurateur/${encodeURIComponent(slug)}/equipe`, {
      method: 'POST',
      body: JSON.stringify({
        nom: $('#nomMembre').value,
        email: $('#emailMembre').value,
        role: $('#roleMembre').value
      })
    });
    $('#nomMembre').value = '';
    $('#emailMembre').value = '';
    const precision = donnees.email_activation_envoye
      ? 'Un email d’activation sécurisé a été envoyé à ce membre.'
      : donnees.mot_de_passe_temporaire
      ? `<span class="mot-de-passe-temporaire">${echapper(donnees.mot_de_passe_temporaire)}</span>Copiez ce mot de passe maintenant : il ne sera plus affiché.`
      : 'Le compte existant a été associé à cet établissement.';
    $('#messageEquipe').className = 'message succes';
    $('#messageEquipe').innerHTML = `Accès créé. ${precision}`;
    await chargerEquipe();
  } catch (erreur) {
    afficherMessage($('#messageEquipe'), erreur.message, 'erreur');
  } finally {
    bouton.disabled = false;
  }
}

async function modifierMembre(ligne, changements) {
  const id = ligne.dataset.membership;
  try {
    await api(`/api/restaurateur/${encodeURIComponent(slug)}/equipe/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify(changements)
    });
    await chargerEquipe();
  } catch (erreur) {
    afficherMessage($('#messageEquipe'), erreur.message, 'erreur');
    await chargerEquipe();
  }
}

async function changerMotDePasse() {
  const bouton = $('#changerMotDePasse');
  bouton.disabled = true;
  afficherMessage($('#messageMotDePasse'), 'Enregistrement...');
  try {
    const donnees = await api('/api/auth/changer-mot-de-passe', {
      method: 'POST', body: JSON.stringify({ password: $('#nouveauMotDePasse').value })
    });
    $('#nouveauMotDePasse').value = '';
    afficherMessage($('#messageMotDePasse'), donnees.message, 'succes');
  } catch (erreur) {
    afficherMessage($('#messageMotDePasse'), erreur.message, 'erreur');
  } finally {
    bouton.disabled = false;
  }
}

async function ouvrirCheckout(plan) {
  const bouton = document.querySelector(`[data-plan="${plan}"]`);
  if (bouton) bouton.disabled = true;
  const messageAbonnement = $('#messageAbonnement');
  const abonnementExistant = Boolean(abonnement?.abonnement_stripe && abonnement?.client_stripe);
  afficherMessage(
    messageAbonnement,
    abonnementExistant
      ? 'Ouverture de votre espace Stripe pour modifier le forfait…'
      : 'Ouverture du paiement sécurisé…'
  );
  try {
    const donnees = abonnementExistant
      ? await api('/api/stripe/portail', { method: 'POST', body: JSON.stringify({}) })
      : await api('/api/stripe/checkout', { method: 'POST', body: JSON.stringify({ plan }) });
    if (!donnees.url) throw new Error('Stripe n’a pas renvoyé de lien de paiement.');
    window.location.assign(donnees.url);
  } catch (erreur) {
    afficherMessage(messageAbonnement, erreur.message, 'erreur');
    messageAbonnement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (bouton) bouton.disabled = false;
  }
}

async function ouvrirPortailStripe() {
  const bouton = $('#gererAbonnement');
  if (bouton) bouton.disabled = true;
  afficherMessage($('#messageAbonnement'), 'Ouverture de votre espace Stripe…');
  try {
    const donnees = await api('/api/stripe/portail', { method: 'POST', body: JSON.stringify({}) });
    if (!donnees.url) throw new Error('Stripe n’a pas renvoyé de lien de gestion.');
    window.location.assign(donnees.url);
  } catch (erreur) {
    afficherMessage($('#messageAbonnement'), erreur.message, 'erreur');
    $('#messageAbonnement')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (bouton) bouton.disabled = false;
  }
}

async function demanderRecuperation() {
  const bouton = $('#envoyerRecuperation');
  bouton.disabled = true;
  afficherMessage($('#messageConnexion'), 'Envoi du lien sécurisé…');
  try {
    const reponse = await fetch('/api/auth/mot-de-passe-oublie', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: $('#emailRecuperation').value })
    });
    const donnees = await reponse.json();
    if (!reponse.ok) throw new Error(donnees.erreur || 'Impossible d’envoyer le lien.');
    afficherMessage($('#messageConnexion'), donnees.message, 'succes');
  } catch (erreur) {
    afficherMessage($('#messageConnexion'), erreur.message, 'erreur');
  } finally {
    bouton.disabled = false;
  }
}

function basculerMenuMobile(ouvrir) {
  const ouverture = ouvrir ?? !document.querySelector('.barre-laterale').classList.contains('ouverte');
  document.querySelector('.barre-laterale').classList.toggle('ouverte', ouverture);
  $('#fondMenuMobile').classList.toggle('visible', ouverture);
  $('#boutonMenuMobile').setAttribute('aria-expanded', String(ouverture));
}
$('#boutonMenuMobile').addEventListener('click', () => basculerMenuMobile());
$('#fondMenuMobile').addEventListener('click', () => basculerMenuMobile(false));
document.addEventListener('keydown', evenement => {
  if (evenement.key === 'Escape') basculerMenuMobile(false);
});
document.querySelectorAll('.navigation').forEach(bouton => bouton.addEventListener('click', () => {
  ouvrirVue(bouton.dataset.vue);
  basculerMenuMobile(false);
}));
document.querySelectorAll('[data-ouvrir-vue]').forEach(bouton => bouton.addEventListener('click', () => ouvrirVue(bouton.dataset.ouvrirVue)));
$('#rechercheClients').addEventListener('input', () => afficherClients(donneesTableau.clients));
$('#messageNotification').addEventListener('input', actualiserApercuNotification);
$('#titreNotification').addEventListener('input', actualiserApercuNotification);
$('#envoyerNotification').addEventListener('click', () => envoyerNotification(false));
$('#envoyerTest').addEventListener('click', () => envoyerNotification(true));
document.querySelectorAll('[name="plateforme"]').forEach(input => input.addEventListener('change', remplirClientsTest));
$('#actualiserCampagnes').addEventListener('click', () => actualiserTableau());
$('#copierLienCarte').addEventListener('click', copierLienCreationCarte);
$('#lancerApercuRoue').addEventListener('click', lancerApercuRoue);
$('#ajouterLot').addEventListener('click', ajouterLigneLot);
$('#listeLotsEdition').addEventListener('click', evenement => {
  const bouton = evenement.target.closest('[data-supprimer-lot]');
  if (bouton) supprimerLigneLot(Number(bouton.dataset.supprimerLot));
});
$('#enregistrerRoue').addEventListener('click', enregistrerRoue);
$('#roueCouleurPrincipale').addEventListener('input', actualiserCouleursApercuRoue);
$('#roueCouleurSecondaire').addEventListener('input', actualiserCouleursApercuRoue);
$('#validerCadeau').addEventListener('click', validerCadeauComptoir);
$('#demarrerScanner').addEventListener('click', demarrerScanner);
$('#relancerScanner').addEventListener('click', demarrerScanner);
$('#enregistrerDesign').addEventListener('click', enregistrerDesign);
$('#regenererSupports').addEventListener('click', regenererSupportsMarketing);
$('#enregistrerLienAvis').addEventListener('click', enregistrerLienAvis);
$('#copierLienMarketing').addEventListener('click', copierLienMarketing);
$('#genListeSupports').addEventListener('click', evenement => {
  const bouton = evenement.target.closest('[data-support]');
  if (bouton) choisirSupportGenerateur(bouton.dataset.support);
});
$('#genListeThemes').addEventListener('click', evenement => {
  const bouton = evenement.target.closest('[data-theme]');
  if (bouton) choisirThemeGenerateur(bouton.dataset.theme);
});
['genCouleurPrincipale', 'genCouleurSecondaire', 'genTitre', 'genSousTitre', 'genToujoursGagnant', 'genLogoUrl', 'genNombreTampons', 'genRecompense', 'genCitation'].forEach(id => {
  $(`#${id}`).addEventListener('input', demanderApercuGenerateur);
});
$('#genEnregistrer').addEventListener('click', enregistrerPersonnalisationGenerateur);
$('#genCopierNfc').addEventListener('click', copierLienNfc);
$('#genExportPdf').addEventListener('click', () => telechargerExportGenerateur('pdf'));
$('#genExportPng').addEventListener('click', () => telechargerExportGenerateur('png'));
$('#genExportSvg').addEventListener('click', () => telechargerExportGenerateur('svg'));
$('#enregistrerParrainage').addEventListener('click', enregistrerParrainage);
$('#enregistrerAntiFraude').addEventListener('click', enregistrerAntiFraude);
$('#periodeStatistiques').addEventListener('change', chargerStatistiques);
$('#tableAlertesFraude').addEventListener('click', evenement => {
  const bouton = evenement.target.closest('[data-traiter-alerte]');
  if (bouton) traiterAlerteFraude(bouton.dataset.traiterAlerte, bouton);
});
$('#tableClients').addEventListener('click', evenement => {
  const bouton = evenement.target.closest('[data-supprimer-client]');
  if (!bouton) return;
  const ligne = bouton.closest('tr');
  const nom = ligne?.querySelector('strong')?.textContent || 'ce client';
  supprimerClient(bouton.dataset.supprimerClient, nom);
});
function actualiserLesDeuxApercusWallet() {
  actualiserApercuWallet();
  actualiserApercuGoogleWallet();
}
document.querySelectorAll('.editeur-design input, .editeur-design textarea').forEach(input =>
  input.addEventListener('input', actualiserLesDeuxApercusWallet)
);
$('#customColorPicker').addEventListener('input', evenement => {
  $('#customColor').value = evenement.target.value.toUpperCase();
  actualiserLesDeuxApercusWallet();
});
document.querySelectorAll('.asset-wallet').forEach(element => {
  element.querySelector('.asset-file').addEventListener('change', evenement => gererSelectionFichierAsset(evenement, element));
  const boutonSupprimer = element.querySelector('.asset-supprimer');
  boutonSupprimer.hidden = !element.querySelector('.asset-url').value.trim();
  boutonSupprimer.addEventListener('click', () => supprimerAsset(element));
});
document.querySelectorAll('[data-modele-wallet]').forEach(bouton =>
  bouton.addEventListener('click', () => appliquerModeleWallet(bouton.dataset.modeleWallet))
);
document.querySelectorAll('[name="walletBarcodeFormat"]').forEach(champ =>
  champ.addEventListener('change', actualiserLesDeuxApercusWallet)
);
$('#walletOnglets').addEventListener('click', evenement => {
  const bouton = evenement.target.closest('[data-plateforme-wallet]');
  if (bouton) basculerOngletWallet(bouton.dataset.plateformeWallet);
});
$('#walletZonesSecurite').addEventListener('change', evenement => {
  walletZonesSecuriteActives = evenement.target.checked;
  actualiserZonesSecurite();
});
window.addEventListener('resize', () => {
  clearTimeout(window.walletResizeMinuteur);
  window.walletResizeMinuteur = setTimeout(actualiserZonesSecurite, 150);
});
document.querySelectorAll('[data-mode-ajustement]').forEach(bouton =>
  bouton.addEventListener('click', () => appliquerModeAjustement(bouton.dataset.modeAjustement))
);
$('#annulerRecadrage').addEventListener('click', fermerRecadrage);
$('#validerRecadrage').addEventListener('click', validerRecadrage);
chargerSpecificationsWallet().catch(erreur => console.error('Spécifications Wallet:', erreur.message));
$('#ajouterMembre').addEventListener('click', ajouterMembre);
$('#actualiserEquipe').addEventListener('click', chargerEquipe);
$('#changerMotDePasse').addEventListener('click', changerMotDePasse);
$('#tableEquipe').addEventListener('change', evenement => {
  if (evenement.target.matches('[data-role-membre]')) {
    modifierMembre(evenement.target.closest('tr'), { role: evenement.target.value });
  }
});
$('#tableEquipe').addEventListener('click', evenement => {
  const bouton = evenement.target.closest('[data-basculer-membre]');
  if (bouton) {
    modifierMembre(bouton.closest('tr'), { active: bouton.dataset.basculerMembre === 'true' });
  }
});
$('#selectEtablissement').addEventListener('change', evenement => {
  const url = new URL(window.location.href);
  url.searchParams.set('restaurant', evenement.target.value);
  url.hash = '';
  window.location.href = url.toString();
});
async function deconnecter() {
  if (utilisationCompte) {
    await fetch('/api/auth/deconnexion', { method: 'POST' }).catch(() => {});
  }
  sessionStorage.removeItem(modeAdmin ? 'bravocard_admin_password' : `bravocard_design_${slug}`);
  window.location.reload();
}
$('#deconnexion').addEventListener('click', deconnecter);
$('#deconnexionEntete').addEventListener('click', deconnecter);

$('#boutonConnexion').addEventListener('click', connecterCompte);
$('#boutonConnexionHistorique').addEventListener('click', connecterHistorique);
$('#motDePasseOublie').addEventListener('click', () => $('#recuperationCompte').classList.toggle('visible'));
$('#envoyerRecuperation').addEventListener('click', demanderRecuperation);
$('#afficherAccesHistorique').addEventListener('click', () => {
  $('#connexionHistorique').classList.toggle('visible');
});
$('#motDePasseConnexion').addEventListener('keydown', evenement => {
  if (evenement.key === 'Enter') connecterCompte();
});
$('#codeAcces').addEventListener('keydown', evenement => {
  if (evenement.key === 'Enter') connecterHistorique();
});
$('#emailRecuperation').addEventListener('keydown', evenement => {
  if (evenement.key === 'Enter') demanderRecuperation();
});
document.querySelectorAll('[data-plan]').forEach(bouton =>
  bouton.addEventListener('click', () => ouvrirCheckout(bouton.dataset.plan))
);
$('#upgradeBouton').addEventListener('click', () => ouvrirChoixAbonnement($('#upgradeSidebar').dataset.plan || 'pro'));
$('#upgradeEntete').addEventListener('click', () => ouvrirChoixAbonnement($('#upgradeEntete').dataset.plan || 'pro'));
$('#gererAbonnement').addEventListener('click', ouvrirPortailStripe);

afficherOffreDemandee();
if (modeAdmin && !motDePasseAdmin) {
  $('#titreConnexion').textContent = 'Accès super-administrateur';
  $('#texteConnexion').textContent = 'Connectez-vous avec votre compte Bravocard ou utilisez temporairement le mot de passe principal.';
  $('#codeAcces').placeholder = 'Mot de passe administrateur';
}

(async () => {
  try {
    await restaurerCompte();
  } catch {
    utilisationCompte = false;
    if (codeAcces || motDePasseAdmin) {
      permissions = ['*'];
      await chargerEspace().catch(() => {});
    }
  }
})();
