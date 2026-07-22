-- Aligne une seule fois les anciennes valeurs par defaut avec les Reglages
-- generaux. Les personnalisations manifestement distinctes sont conservees.

update public.restaurants
set
  apple_logo_text = case
    when coalesce(trim(apple_logo_text), '') in ('', 'Bravocard') then nom
    else apple_logo_text
  end,
  apple_logo_url = case
    when apple_logo_url is null then logo_url
    else apple_logo_url
  end,
  apple_icon_url = case
    when apple_icon_url is null then logo_url
    else apple_icon_url
  end,
  google_program_logo_url = case
    when google_program_logo_url is null then logo_url
    else google_program_logo_url
  end,
  communication_logo_url = case
    when communication_logo_url is null then logo_url
    else communication_logo_url
  end,
  apple_custom_color = case
    when apple_custom_color is null or upper(apple_custom_color) in ('#17171D', '#1B1030')
      then couleur_principale
    else apple_custom_color
  end,
  google_custom_color = case
    when google_custom_color is null or upper(google_custom_color) in ('#17171D', '#1B1030')
      then couleur_principale
    else google_custom_color
  end,
  roue_couleur_principale = case
    when roue_couleur_principale is null or upper(roue_couleur_principale) = '#6C3CE9'
      then couleur_principale
    else roue_couleur_principale
  end,
  roue_couleur_secondaire = case
    when roue_couleur_secondaire is null or upper(roue_couleur_secondaire) = '#E8891F'
      then couleur_secondaire
    else roue_couleur_secondaire
  end,
  communication_primary_color = case
    when communication_primary_color is null or upper(communication_primary_color) = '#6C3CE9'
      then couleur_principale
    else communication_primary_color
  end,
  communication_secondary_color = case
    when communication_secondary_color is null or upper(communication_secondary_color) = '#E8891F'
      then couleur_secondaire
    else communication_secondary_color
  end,
  apple_points_label = case
    when apple_points_label is null
      or upper(apple_points_label) in ('POINTS FIDELITE', 'POINTS FIDÉLITÉ')
      or upper(apple_points_label) ~ '^POINTS SUR [0-9]+$'
      then 'POINTS SUR ' || coalesce(seuil_recompense, 100)::text
    else apple_points_label
  end,
  apple_reward_text = case
    when apple_reward_text is null
      or upper(apple_reward_text) in ('RECOMPENSE A DEBLOQUER', 'RÉCOMPENSE À DÉBLOQUER')
      then description_recompense
    else apple_reward_text
  end
where deleted_at is null;

update public.fraud_settings as f
set
  max_points_per_scan = greatest(f.max_points_per_scan, r.points_per_scan),
  max_points_per_day = greatest(f.max_points_per_day, r.points_per_scan),
  updated_at = now()
from public.restaurants as r
where r.id = f.restaurant_id
  and r.deleted_at is null
  and (
    f.max_points_per_scan < r.points_per_scan
    or f.max_points_per_day < r.points_per_scan
  );
