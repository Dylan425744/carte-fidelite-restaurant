ALTER TABLE public.fraud_settings
  DROP CONSTRAINT fraud_settings_max_points_per_scan_check;

ALTER TABLE public.fraud_settings
  ADD CONSTRAINT fraud_settings_max_points_per_scan_check
  CHECK (max_points_per_scan >= 1 AND max_points_per_scan <= 2500);

CREATE OR REPLACE FUNCTION public.enregistrer_scan_securise(p_restaurant_id uuid, p_client_id uuid, p_points integer)
 RETURNS TABLE(autorise boolean, motif text, scan_id uuid, nouveau_solde integer, prochaine_autorisation timestamp with time zone)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_client public.clients%rowtype;
  v_reglages public.fraud_settings%rowtype;
  v_points_programme integer := 10;
  v_dernier_scan timestamp;
  v_scans_jour integer := 0;
  v_points_jour integer := 0;
  v_scan_id uuid;
  v_nouveau_solde integer;
  v_motif text;
  v_gravite text;
  v_prochaine_autorisation timestamptz;
begin
  if p_points is null or p_points < 1 or p_points > 2500 then
    raise exception 'Le nombre de points est invalide.';
  end if;

  select * into v_client
  from public.clients
  where id = p_client_id
  for update;

  if not found or v_client.restaurant_id is distinct from p_restaurant_id then
    raise exception 'Cette carte ne correspond pas a cet etablissement.';
  end if;

  select coalesce(points_per_scan, 10) into v_points_programme
  from public.restaurants
  where id = p_restaurant_id;

  select * into v_reglages
  from public.fraud_settings
  where restaurant_id = p_restaurant_id;

  if not found then
    insert into public.fraud_settings (
      restaurant_id,
      max_points_per_scan,
      max_points_per_day
    ) values (
      p_restaurant_id,
      greatest(10, v_points_programme),
      greatest(50, v_points_programme)
    )
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

    if p_points > greatest(v_reglages.max_points_per_scan, v_points_programme) then
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
      restaurant_id, client_id, alert_type, severity, attempted_points, details
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

    return query select false, v_motif, null::uuid, v_client.points, v_prochaine_autorisation;
    return;
  end if;

  update public.clients
  set points = coalesce(points, 0) + p_points,
      points_cumules = coalesce(points_cumules, 0) + p_points
  where id = p_client_id
  returning points into v_nouveau_solde;

  insert into public.scans (client_id, restaurant_id, points_ajoutes)
  values (p_client_id, p_restaurant_id, p_points)
  returning id into v_scan_id;

  return query select true, null::text, v_scan_id, v_nouveau_solde, null::timestamptz;
end;
$function$;
