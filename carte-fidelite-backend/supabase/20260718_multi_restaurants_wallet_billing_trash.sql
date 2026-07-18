-- Isolation Google Wallet par restaurant, corbeille et verrouillage Stripe.
-- Migration additive : aucune donnee existante n'est supprimee.

alter table public.restaurants
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null,
  add column if not exists deletion_reason text,
  add column if not exists restored_at timestamptz,
  add column if not exists active_before_delete boolean,
  add column if not exists billing_owner_user_id uuid references auth.users(id) on delete set null,
  add column if not exists billing_status text not null default 'inactive',
  add column if not exists billing_current_period_end timestamptz,
  add column if not exists billing_locked_at timestamptz,
  add column if not exists billing_updated_at timestamptz,
  add column if not exists google_wallet_class_id text,
  add column if not exists google_wallet_class_status text,
  add column if not exists google_wallet_design_version integer not null default 1,
  add column if not exists google_wallet_synced_at timestamptz,
  add column if not exists google_wallet_sync_error text;

alter table public.restaurants
  drop constraint if exists restaurants_billing_status_check;

alter table public.restaurants
  add constraint restaurants_billing_status_check check (
    billing_status in (
      'inactive', 'trialing', 'active', 'past_due', 'canceled', 'unpaid',
      'paused', 'incomplete', 'incomplete_expired'
    )
  );

alter table public.restaurants
  drop constraint if exists restaurants_deletion_reason_check;

alter table public.restaurants
  add constraint restaurants_deletion_reason_check check (
    deletion_reason is null or char_length(deletion_reason) <= 500
  );

create unique index if not exists restaurants_google_wallet_class_unique
  on public.restaurants (google_wallet_class_id)
  where google_wallet_class_id is not null;

create index if not exists restaurants_deleted_at_idx
  on public.restaurants (deleted_at)
  where deleted_at is not null;

create index if not exists restaurants_billing_status_idx
  on public.restaurants (billing_status, billing_locked_at);

-- Tous les clients sont deja rattaches a un restaurant. La contrainte empeche
-- qu'une future carte soit creee sans etablissement.
alter table public.clients
  alter column restaurant_id set not null;

create unique index if not exists clients_google_wallet_object_unique
  on public.clients (google_wallet_object_id)
  where google_wallet_object_id is not null;

-- Reprend l'abonnement du premier proprietaire actif de chaque restaurant.
with proprietaires as (
  select distinct on (m.restaurant_id)
    m.restaurant_id,
    p.user_id,
    coalesce(p.stripe_subscription_status, 'inactive') as statut,
    p.subscription_current_period_end,
    p.subscription_updated_at
  from public.restaurant_memberships m
  join public.user_profiles p on p.user_id = m.user_id
  where m.role = 'owner' and m.active = true
  order by m.restaurant_id, m.created_at
)
update public.restaurants r
set billing_owner_user_id = p.user_id,
    billing_status = p.statut,
    billing_current_period_end = p.subscription_current_period_end,
    billing_updated_at = coalesce(p.subscription_updated_at, now()),
    billing_locked_at = case
      when p.statut in ('active', 'trialing') then null
      when p.statut = 'past_due'
        and coalesce(p.subscription_current_period_end, now()) + interval '7 days' > now()
        then null
      else coalesce(r.billing_locked_at, now())
    end
from proprietaires p
where p.restaurant_id = r.id;

update public.restaurants
set billing_locked_at = coalesce(billing_locked_at, now()),
    billing_updated_at = coalesce(billing_updated_at, now())
where billing_owner_user_id is null;

-- Les tables sont exclusivement utilisees par le backend service_role.
alter table public.restaurants enable row level security;
alter table public.clients enable row level security;
alter table public.scans enable row level security;

revoke all on table public.restaurants from anon, authenticated;
revoke all on table public.clients from anon, authenticated;
revoke all on table public.scans from anon, authenticated;

grant select, insert, update, delete on table public.restaurants to service_role;
grant select, insert, update, delete on table public.clients to service_role;
grant select, insert, update, delete on table public.scans to service_role;
