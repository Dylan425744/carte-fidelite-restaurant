-- Programme de parrainage Bravocard.
-- Les nouvelles tables sont accessibles uniquement au backend service_role.

create table if not exists public.referral_settings (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  enabled boolean not null default true,
  sponsor_points integer not null default 20
    check (sponsor_points between 1 and 500),
  referee_points integer not null default 20
    check (referee_points between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.referral_codes (
  client_id uuid primary key references public.clients(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  code text not null unique check (code ~ '^[A-Z0-9]{8,12}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  sponsor_client_id uuid not null references public.clients(id) on delete cascade,
  referred_client_id uuid not null references public.clients(id) on delete cascade,
  referral_code text not null,
  status text not null default 'pending'
    check (status in ('pending', 'validated', 'rejected')),
  sponsor_points_awarded integer not null default 0,
  referee_points_awarded integer not null default 0,
  rejection_reason text,
  created_at timestamptz not null default now(),
  validated_at timestamptz,
  validation_scan_id uuid unique references public.scans(id) on delete set null,
  constraint referrals_different_clients_check
    check (sponsor_client_id <> referred_client_id),
  constraint referrals_one_sponsor_per_referred_unique
    unique (restaurant_id, referred_client_id)
);

create index if not exists referral_codes_restaurant_id_idx
  on public.referral_codes (restaurant_id);

create index if not exists referrals_restaurant_status_created_idx
  on public.referrals (restaurant_id, status, created_at desc);

create index if not exists referrals_sponsor_client_id_idx
  on public.referrals (sponsor_client_id);

create index if not exists referrals_referred_client_id_idx
  on public.referrals (referred_client_id);

alter table public.referral_settings enable row level security;
alter table public.referral_codes enable row level security;
alter table public.referrals enable row level security;

revoke all on table public.referral_settings from anon, authenticated;
revoke all on table public.referral_codes from anon, authenticated;
revoke all on table public.referrals from anon, authenticated;

grant select, insert, update, delete on table public.referral_settings to service_role;
grant select, insert, update, delete on table public.referral_codes to service_role;
grant select, insert, update, delete on table public.referrals to service_role;

insert into public.referral_settings (restaurant_id)
select id from public.restaurants
on conflict (restaurant_id) do nothing;

insert into public.referral_codes (client_id, restaurant_id, code)
select
  id,
  restaurant_id,
  'BRV' || upper(substr(md5(id::text), 1, 9))
from public.clients
where restaurant_id is not null
on conflict (client_id) do nothing;

create or replace function public.valider_parrainage_en_attente(
  p_filleul_id uuid,
  p_scan_id uuid
)
returns table (
  referral_id uuid,
  sponsor_client_id uuid,
  sponsor_points_awarded integer,
  referee_points_awarded integer,
  sponsor_balance integer,
  referee_balance integer
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_parrainage public.referrals%rowtype;
  v_reglages public.referral_settings%rowtype;
  v_solde_parrain integer;
  v_solde_filleul integer;
begin
  if not exists (
    select 1 from public.scans
    where id = p_scan_id and client_id = p_filleul_id
  ) then
    raise exception 'Le scan de validation est invalide.';
  end if;

  select * into v_parrainage
  from public.referrals
  where referred_client_id = p_filleul_id
    and status = 'pending'
  for update
  limit 1;

  if not found then
    return;
  end if;

  select * into v_reglages
  from public.referral_settings
  where restaurant_id = v_parrainage.restaurant_id;

  if not found or v_reglages.enabled is false then
    return;
  end if;

  update public.clients
  set points = coalesce(points, 0) + v_reglages.sponsor_points
  where id = v_parrainage.sponsor_client_id
    and restaurant_id = v_parrainage.restaurant_id
  returning points into v_solde_parrain;

  update public.clients
  set points = coalesce(points, 0) + v_reglages.referee_points
  where id = v_parrainage.referred_client_id
    and restaurant_id = v_parrainage.restaurant_id
  returning points into v_solde_filleul;

  if v_solde_parrain is null or v_solde_filleul is null then
    raise exception 'Les clients du parrainage sont invalides.';
  end if;

  update public.referrals
  set
    status = 'validated',
    sponsor_points_awarded = v_reglages.sponsor_points,
    referee_points_awarded = v_reglages.referee_points,
    validation_scan_id = p_scan_id,
    validated_at = now()
  where id = v_parrainage.id;

  return query select
    v_parrainage.id,
    v_parrainage.sponsor_client_id,
    v_reglages.sponsor_points,
    v_reglages.referee_points,
    v_solde_parrain,
    v_solde_filleul;
end;
$$;

revoke all on function public.valider_parrainage_en_attente(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.valider_parrainage_en_attente(uuid, uuid)
  to service_role;
