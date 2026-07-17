const Stripe = require('stripe');
const supabase = require('./supabaseClient');

let clientStripe = null;

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
    process.env.STRIPE_PRICE_PREMIUM_ID
  );
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

async function creerCheckout(profil, urlBase) {
  const stripe = obtenirStripe();
  const prix = process.env.STRIPE_PRICE_PREMIUM_ID;
  if (!prix) throw new Error('Le tarif Premium Stripe n’est pas configuré.');
  const customer = await enregistrerClientStripe(profil, stripe);
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer,
    line_items: [{ price: prix, quantity: 1 }],
    allow_promotion_codes: true,
    client_reference_id: profil.user_id,
    metadata: { bravocard_user_id: profil.user_id, plan: 'premium' },
    subscription_data: {
      metadata: { bravocard_user_id: profil.user_id, plan: 'premium' }
    },
    success_url: `${urlBase}/espace-restaurateur.html?abonnement=succes`,
    cancel_url: `${urlBase}/espace-restaurateur.html?abonnement=annule#compte`
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
  const premium = priceId === process.env.STRIPE_PRICE_PREMIUM_ID;
  const miseAJour = {
    stripe_subscription_id: abonnement.id,
    stripe_subscription_status: abonnement.status || 'inactive',
    stripe_price_id: priceId,
    subscription_plan: premium ? 'premium' : 'starter',
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
  estConfigure,
  traiterWebhook
};
