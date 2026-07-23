CREATE OR REPLACE FUNCTION public.valider_parrainage_en_attente(p_filleul_id uuid, p_scan_id uuid)
 RETURNS TABLE(referral_id uuid, sponsor_client_id uuid, sponsor_points_awarded integer, referee_points_awarded integer, sponsor_balance integer, referee_balance integer)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  where referred_client_id = p_filleul_id and status = 'pending'
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
  set points = coalesce(points, 0) + v_reglages.sponsor_points,
      points_cumules = coalesce(points_cumules, 0) + v_reglages.sponsor_points
  where id = v_parrainage.sponsor_client_id
    and restaurant_id = v_parrainage.restaurant_id
  returning points into v_solde_parrain;

  update public.clients
  set points = coalesce(points, 0) + v_reglages.referee_points,
      points_cumules = coalesce(points_cumules, 0) + v_reglages.referee_points
  where id = v_parrainage.referred_client_id
    and restaurant_id = v_parrainage.restaurant_id
  returning points into v_solde_filleul;

  if v_solde_parrain is null or v_solde_filleul is null then
    raise exception 'Les clients du parrainage sont invalides.';
  end if;

  update public.referrals
  set status = 'validated',
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
$function$;

-- Rattrapage historique : le backfill initial de points_cumules reprenait le
-- solde de points courant, qui avait deja ete remis a zero pour tout client
-- ayant recupere une recompense avant l'ajout des niveaux VIP. On recalcule
-- ici le vrai total a vie a partir des scans et des bonus de parrainage
-- valides, sans jamais faire redescendre points_cumules.
update public.clients c
set points_cumules = greatest(
  coalesce(c.points_cumules, 0),
  coalesce((select sum(s.points_ajoutes) from public.scans s where s.client_id = c.id), 0)
  + coalesce((select sum(r.sponsor_points_awarded) from public.referrals r where r.sponsor_client_id = c.id and r.status = 'validated'), 0)
  + coalesce((select sum(r.referee_points_awarded) from public.referrals r where r.referred_client_id = c.id and r.status = 'validated'), 0)
);
