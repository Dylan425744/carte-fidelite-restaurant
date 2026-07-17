-- Statistiques agrégées par commerce, calculées côté PostgreSQL.

create index if not exists clients_restaurant_date_inscription_idx
  on public.clients (restaurant_id, date_inscription desc)
  where restaurant_id is not null;

create or replace function public.obtenir_statistiques_restaurant(
  p_restaurant_id uuid,
  p_jours integer default 30
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with parametres as (
  select
    greatest(7, least(coalesce(p_jours, 30), 365)) as jours,
    current_date - (greatest(7, least(coalesce(p_jours, 30), 365)) - 1) as debut
),
clients_resto as (
  select c.*
  from public.clients c
  where c.restaurant_id = p_restaurant_id
),
scans_resto as (
  select s.*
  from public.scans s, parametres p
  where s.restaurant_id = p_restaurant_id
    and s.date_scan >= p.debut
),
visites_clients as (
  select s.client_id, count(*)::integer as visites
  from public.scans s
  join clients_resto c on c.id = s.client_id
  group by s.client_id
),
serie_dates as (
  select generate_series(p.debut, current_date, interval '1 day')::date as jour
  from parametres p
),
serie as (
  select
    d.jour,
    count(distinct s.id)::integer as scans,
    coalesce(sum(s.points_ajoutes), 0)::integer as points,
    count(distinct c.id)::integer as inscriptions
  from serie_dates d
  left join scans_resto s on s.date_scan::date = d.jour
  left join clients_resto c on c.date_inscription::date = d.jour
  group by d.jour
  order by d.jour
),
top_clients as (
  select
    c.id,
    c.nom,
    count(s.id)::integer as visites,
    coalesce(sum(s.points_ajoutes), 0)::integer as points_gagnes,
    max(s.date_scan) as derniere_visite
  from clients_resto c
  join scans_resto s on s.client_id = c.id
  group by c.id, c.nom
  order by visites desc, points_gagnes desc, c.nom
  limit 8
),
jours_semaine as (
  select
    extract(dow from s.date_scan)::integer as numero,
    count(*)::integer as scans
  from scans_resto s
  group by extract(dow from s.date_scan)
),
parrainages as (
  select
    count(*) filter (where status = 'validated')::integer as valides,
    count(*) filter (where status = 'pending')::integer as en_attente,
    count(*)::integer as total
  from public.referrals
  where restaurant_id = p_restaurant_id
)
select jsonb_build_object(
  'periode_jours', (select jours from parametres),
  'indicateurs', jsonb_build_object(
    'clients_total', (select count(*)::integer from clients_resto),
    'nouveaux_clients', (
      select count(*)::integer from clients_resto c, parametres p
      where c.date_inscription >= p.debut
    ),
    'clients_actifs', (select count(distinct client_id)::integer from scans_resto),
    'scans', (select count(*)::integer from scans_resto),
    'points_distribues', (select coalesce(sum(points_ajoutes), 0)::integer from scans_resto),
    'taux_retour', coalesce((
      select round(
        100.0 * count(*) filter (where visites >= 2)
        / nullif(count(*), 0),
        1
      )
      from visites_clients
    ), 0),
    'visites_par_client_actif', coalesce((
      select round(count(*)::numeric / nullif(count(distinct client_id), 0), 1)
      from scans_resto
    ), 0),
    'parrainages_valides', (select valides from parrainages),
    'conversion_parrainage', coalesce((
      select round(100.0 * valides / nullif(total, 0), 1) from parrainages
    ), 0)
  ),
  'evolution', coalesce((
    select jsonb_agg(jsonb_build_object(
      'date', jour,
      'scans', scans,
      'points', points,
      'inscriptions', inscriptions
    ) order by jour)
    from serie
  ), '[]'::jsonb),
  'jours_semaine', (
    select jsonb_agg(jsonb_build_object(
      'numero', numero,
      'jour', (array['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'])[numero + 1],
      'scans', coalesce(j.scans, 0)
    ) order by numero)
    from generate_series(0, 6) as jours(numero)
    left join jours_semaine j using (numero)
  ),
  'top_clients', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id,
      'nom', nom,
      'visites', visites,
      'points_gagnes', points_gagnes,
      'derniere_visite', derniere_visite
    ) order by visites desc, points_gagnes desc, nom)
    from top_clients
  ), '[]'::jsonb),
  'wallets', jsonb_build_object(
    'apple', (select count(*)::integer from clients_resto where apple_wallet_serial is not null),
    'google', (select count(*)::integer from clients_resto where google_wallet_object_id is not null),
    'sans_apple', (select count(*)::integer from clients_resto where apple_wallet_serial is null)
  )
);
$$;

revoke all on function public.obtenir_statistiques_restaurant(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.obtenir_statistiques_restaurant(uuid, integer)
  to service_role;
