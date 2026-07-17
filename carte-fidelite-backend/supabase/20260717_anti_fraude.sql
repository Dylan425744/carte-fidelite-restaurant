-- Protection anti-fraude Bravocard.
-- Les contrôles et l'ajout de points sont exécutés dans une seule transaction.

create table if not exists public.fraud_settings (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  enabled boolean not null default true,
  cooldown_minutes integer not null default 10
    check (cooldown_minutes between 1 and 1440),
  max_scans_per_day integer not null default 5
    check (max_scans_per_day between 1 and 100),
  max_points_per_scan integer not null default 10
    check (max_points_per_scan between 1 and 500),
  max_points_per_day integer not null default 50
    check (max_points_per_day between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fraud_alerts (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  alert_type text not null check (
    alert_type in (
      'duplicate_scan',
      'daily_scan_limit',
      'points_per_scan_limit',
      'daily_points_limit'
    )
  ),
  severity text not null check (severity in ('low', 'medium', 'high')),
  status text not null default 'new'
    check (status in ('new', 'reviewed', 'dismissed')),
  attempted_points integer not null default 0,
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  review_note text
);

alter table public.scans
  add column if not exists restaurant_id uuid references public.restaurants(id) on delete set null;

update public.scans s
set restaurant_id = c.restaurant_id
from public.clients c
where s.client_id = c.id
  and s.restaurant_id is null;

create index if not exists scans_client_date_idx
  on public.scans (client_id, date_scan desc);

create index if not exists scans_restaurant_date_idx
  on public.scans (restaurant_id, date_scan desc)
  where restaurant_id is not null;

create index if not exists fraud_alerts_restaurant_status_date_idx
  on public.fraud_alerts (restaurant_id, status, created_at desc);

create index if not exists fraud_alerts_client_date_idx
  on public.fraud_alerts (client_id, created_at desc)
  where client_id is not null;

alter table public.fraud_settings enable row level security;
alter table public.fraud_alerts enable row level security;

revoke all on table public.fraud_settings from anon, authenticated;
revoke all on table public.fraud_alerts from anon, authenticated;

grant select, insert, update, delete on table public.fraud_settings to service_role;
grant select, insert, update, delete on table public.fraud_alerts to service_role;

insert into public.fraud_settings (restaurant_id)
select id from public.restaurants
on conflict (restaurant_id) do nothing;

create or replace function public.enregistrer_scan_securise(
  p_restaurant_id uuid,
  p_client_id uuid,
  p_points integer
)
returns table (
  autorise boolean,
  motif text,
  scan_id uuid,
  nouveau_solde integer,
  prochaine_autorisation timestamptz
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_client public.clients%rowtype;
  v_reglages public.fraud_settings%rowtype;
  v_dernier_scan timestamp;
  v_scans_jour integer := 0;
  v_points_jour integer := 0;
  v_scan_id uuid;
  v_nouveau_solde integer;
  v_motif text;
  v_gravite text;
  v_prochaine_autorisation timestamptz;
begin
  if p_points is null or p_points < 1 or p_points > 500 then
    raise exception 'Le nombre de points est invalide.';
  end if;

  select * into v_client
  from public.clients
  where id = p_client_id
  for update;

  if not found or v_client.restaurant_id is distinct from p_restaurant_id then
    raise exception 'Cette carte ne correspond pas à cet établissement.';
  end if;

  select * into v_reglages
  from public.fraud_settings
  where restaurant_id = p_restaurant_id;

  if not found then
    insert into public.fraud_settings (restaurant_id)
    values (p_restaurant_id)
    returning * into v_reglages;
  end if;

  if v_reglages.enabled then
    select max(date_scan), count(*), coalesce(sum(points_ajoutes), 0)
    into v_dernier_scan, v_scans_jour, v_points_jour
    from public.scans
    where client_id = p_client_id
      and date_scan >= (
        date_trunc('day', now() at time zone 'Europe/Paris')
        at time zone 'Europe/Paris'
      );

    if p_points > v_reglages.max_points_per_scan then
      v_motif := 'points_per_scan_limit';
      v_gravite := 'high';
    elsif v_dernier_scan is not null
      and v_dernier_scan > (now() - make_interval(mins => v_reglages.cooldown_minutes)) then
      v_motif := 'duplicate_scan';
      v_gravite := 'medium';
      v_prochaine_autorisation := v_dernier_scan at time zone 'UTC'
        + make_interval(mins => v_reglages.cooldown_minutes);
    elsif v_scans_jour >= v_reglages.max_scans_per_day then
      v_motif := 'daily_scan_limit';
      v_gravite := 'high';
    elsif v_points_jour + p_points > v_reglages.max_points_per_day then
      v_motif := 'daily_points_limit';
      v_gravite := 'high';
    end if;
  end if;

  if v_motif is not null then
    insert into public.fraud_alerts (
      restaurant_id,
      client_id,
      alert_type,
      severity,
      attempted_points,
      details
    ) values (
      p_restaurant_id,
      p_client_id,
      v_motif,
      v_gravite,
      p_points,
      jsonb_build_object(
        'scans_today', v_scans_jour,
        'points_today', v_points_jour,
        'last_scan_at', v_dernier_scan,
        'cooldown_minutes', v_reglages.cooldown_minutes
      )
    );

    return query select
      false,
      v_motif,
      null::uuid,
      v_client.points,
      v_prochaine_autorisation;
    return;
  end if;

  update public.clients
  set points = coalesce(points, 0) + p_points
  where id = p_client_id
  returning points into v_nouveau_solde;

  insert into public.scans (client_id, restaurant_id, points_ajoutes)
  values (p_client_id, p_restaurant_id, p_points)
  returning id into v_scan_id;

  return query select
    true,
    null::text,
    v_scan_id,
    v_nouveau_solde,
    null::timestamptz;
end;
$$;

revoke all on function public.enregistrer_scan_securise(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.enregistrer_scan_securise(uuid, uuid, integer)
  to service_role;
