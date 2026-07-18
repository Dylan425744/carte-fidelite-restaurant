const Stripe = require('stripe');
const supabase = require('./supabaseClient');

let clientStripe = null;

const PLANS = Object.freeze({
  starter: { nom: 'Essentiel', prix_env: 'STRIPE_PRICE_STARTER_ID', limite_etablissements: 1 },
  pro: { nom: 'Croissance', prix_env: 'STRIPE_PRICE_PRO_ID', limite_etablissements: 1 },
  premium: { nom: 'Signature', prix_env: 'STRIPE_PRICE_PREMIUM_ID', limite_etablissements: 5 }
});

function obtenirStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('La facturation Stripe n’est pas encore configurée.');
  }
  if (!clientStripe) clientStripe = Stripe(process.env.STRIPE_SECRET_KEY);
  return clientStripe;
}

function estConfigure() {
  return Boolean(
    process.env.STRIPE_SECRET_KEY &&
    process.env.STRIPE_WEBHOOK_SECRET &&
    Object.values(PLANS).every(plan => process.env[plan.prix_env])
  );
}

function planValide(plan) {
  return Object.prototype.hasOwnProperty.call(PLANS, plan) ? plan : null;
}

function planDepuisPrix(priceId) {
  return Object.entries(PLANS).find(([, plan]) =>
    process.env[plan.prix_env] === priceId
  )?.[0] || 'starter';
}

function cataloguePlans() {
  return Object.entries(PLANS).map(([id, plan]) => ({
    id,
    nom: plan.nom,
    limite_etablissements: plan.limite_etablissements,
    configure: Boolean(process.env[plan.prix_env])
  }));
}

function identifiant(objet) {
  return typeof objet === 'string' ? objet : objet?.id || null;
}

function dateDepuisSecondes(secondes) {
  return Number.isFinite(Number(secondes))
    ? new Date(Number(secondes) * 1000).toISOString()
    : null;
}

async function enregistrerClientStripe(profil, stripe) {
  if (profil.stripe_customer_id) return profil.stripe_customer_id;
  const client = await stripe.customers.create({
    email: profil.email,
    name: profil.full_name,
    metadata: { bravocard_user_id: profil.user_id }
  });
  const { error } = await supabase
    .from('user_profiles')
    .update({ stripe_customer_id: client.id, subscription_updated_at: new Date().toISOString() })
    .eq('user_id', profil.user_id);
  if (error) throw error;
  return client.id;
}

async function creerCheckout(profil, urlBase, planRecu) {
  const stripe = obtenirStripe();
  const planId = planValide(planRecu);
  if (!planId) throw new Error('Le forfait demandé est invalide.');
  const plan = PLANS[planId];
  const prix = process.env[plan.prix_env];
  if (!prix) throw new Error(`Le forfait ${plan.nom} n’est pas encore configuré dans Stripe.`);
  if (profil.stripe_subscription_id && ['active', 'trialing', 'past_due'].includes(profil.stripe_subscription_status)) {
    throw new Error('Votre abonnement existe déjà. Utilisez « Gérer mon abonnement » pour changer de forfait ou le résilier.');
  }
  const customer = await enregistrerClientStripe(profil, stripe);
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer,
    line_items: [{ price: prix, quantity: 1 }],
    allow_promotion_codes: true,
    billing_address_collection: 'auto',
    client_reference_id: profil.user_id,
    metadata: { bravocard_user_id: profil.user_id, plan: planId },
    subscription_data: {
      metadata: { bravocard_user_id: profil.user_id, plan: planId },
      trial_period_days: 14
    },
    success_url: `${urlBase}/espace-restaurateur.html?abonnement=succes`,
    cancel_url: `${urlBase}/espace-restaurateur.html?abonnement=annule#compte`,
    consent_collection: { terms_of_service: 'required' },
    custom_text: {
      submit: { message: `En continuant, vous acceptez les CGV Bravocard : ${urlBase}/cgv.html` }
    }
  });
  return session.url;
}

async function creerPortail(profil, urlBase) {
  if (!profil.stripe_customer_id) {
    throw new Error('Aucun abonnement Stripe n’est associé à ce compte.');
  }
  const session = await obtenirStripe().billingPortal.sessions.create({
    customer: profil.stripe_customer_id,
    return_url: `${urlBase}/espace-restaurateur.html#compte`
  });
  return session.url;
}

async function mettreAJourAbonnement(abonnement) {
  const customerId = identifiant(abonnement.customer);
  const item = abonnement.items?.data?.[0] || null;
  const priceId = item?.price?.id || null;
  const plan = planDepuisPrix(priceId);
  const miseAJour = {
    stripe_subscription_id: abonnement.id,
    stripe_subscription_status: abonnement.status || 'inactive',
    stripe_price_id: priceId,
    subscription_plan: plan,
    subscription_current_period_end: dateDepuisSecondes(item?.current_period_end),
    subscription_updated_at: new Date().toISOString()
  };

  let requete = supabase.from('user_profiles').update(miseAJour);
  if (customerId) {
    requete = requete.eq('stripe_customer_id', customerId);
  } else if (abonnement.metadata?.bravocard_user_id) {
    requete = requete.eq('user_id', abonnement.metadata.bravocard_user_id);
  } else {
    throw new Error('Abonnement Stripe impossible à associer à un compte Bravocard.');
  }
  const { error } = await requete;
  if (error) throw error;
}

async function traiterWebhook(corpsBrut, signature) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('Le secret webhook Stripe est absent.');
  const stripe = obtenirStripe();
  const evenement = stripe.webhooks.constructEvent(corpsBrut, signature, secret);

  if (['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'].includes(evenement.type)) {
    await mettreAJourAbonnement(evenement.data.object);
  } else if (evenement.type === 'checkout.session.completed') {
    const session = evenement.data.object;
    if (session.subscription) {
      const abonnement = await stripe.subscriptions.retrieve(identifiant(session.subscription));
      await mettreAJourAbonnement(abonnement);
    }
  }
  return evenement.type;
}

module.exports = {
  creerCheckout,
  creerPortail,
  cataloguePlans,
  estConfigure,
  planDepuisPrix,
  planValide,
  traiterWebhook
};
