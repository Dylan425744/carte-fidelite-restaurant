alter table public.user_profiles
  add column if not exists subscription_plan text not null default 'starter',
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_subscription_status text not null default 'inactive',
  add column if not exists stripe_price_id text,
  add column if not exists subscription_current_period_end timestamptz,
  add column if not exists subscription_updated_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_profiles_subscription_plan_check'
      and conrelid = 'public.user_profiles'::regclass
  ) then
    alter table public.user_profiles
      add constraint user_profiles_subscription_plan_check
      check (subscription_plan in ('starter', 'pro', 'premium'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'user_profiles_subscription_status_check'
      and conrelid = 'public.user_profiles'::regclass
  ) then
    alter table public.user_profiles
      add constraint user_profiles_subscription_status_check
      check (stripe_subscription_status in (
        'inactive', 'trialing', 'active', 'past_due', 'canceled',
        'unpaid', 'paused', 'incomplete', 'incomplete_expired'
      ));
  end if;
end $$;

create unique index if not exists user_profiles_stripe_customer_uidx
  on public.user_profiles (stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists user_profiles_stripe_subscription_uidx
  on public.user_profiles (stripe_subscription_id)
  where stripe_subscription_id is not null;

alter table public.restaurants
  add column if not exists apple_program_name text,
  add column if not exists apple_reward_text text,
  add column if not exists apple_terms text;

update public.restaurants
set apple_pro_design = true
where apple_pro_design is distinct from true;

create table if not exists public.password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint password_reset_tokens_hash_check check (token_hash ~ '^[a-f0-9]{64}$'),
  constraint password_reset_tokens_expiry_check check (expires_at > created_at)
);

create unique index if not exists password_reset_tokens_hash_uidx
  on public.password_reset_tokens (token_hash);

create index if not exists password_reset_tokens_user_expiry_idx
  on public.password_reset_tokens (user_id, expires_at desc)
  where used_at is null;

alter table public.password_reset_tokens enable row level security;
revoke all on public.password_reset_tokens from anon, authenticated;
grant all on public.password_reset_tokens to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wallet-assets', 'wallet-assets', true, 2097152, array['image/png'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
