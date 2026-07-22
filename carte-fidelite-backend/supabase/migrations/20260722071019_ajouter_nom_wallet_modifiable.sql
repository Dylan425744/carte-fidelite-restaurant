alter table public.restaurants
  add column if not exists wallet_display_name text,
  add column if not exists wallet_points_label text,
  add column if not exists wallet_card_label text,
  add column if not exists wallet_reward_text text;

update public.restaurants
set
  wallet_display_name = coalesce(
    wallet_display_name,
    left(coalesce(nullif(trim(apple_logo_text), ''), nom), 80)
  ),
  wallet_points_label = coalesce(wallet_points_label, coalesce(
    nullif(trim(apple_points_label), ''),
    'POINTS SUR ' || coalesce(seuil_recompense, 100)::text
  )),
  wallet_card_label = coalesce(
    wallet_card_label,
    nullif(trim(apple_card_label), ''),
    'FIDÉLITÉ'
  ),
  wallet_reward_text = coalesce(wallet_reward_text, coalesce(
    nullif(trim(apple_reward_text), ''),
    nullif(trim(description_recompense), '')
  ))
where wallet_display_name is null
   or wallet_points_label is null
   or wallet_card_label is null
   or wallet_reward_text is null;

alter table public.restaurants
  drop constraint if exists restaurants_wallet_display_name_length,
  drop constraint if exists restaurants_wallet_points_label_length,
  drop constraint if exists restaurants_wallet_card_label_length,
  drop constraint if exists restaurants_wallet_reward_text_length;

alter table public.restaurants
  add constraint restaurants_wallet_display_name_length
    check (wallet_display_name is null or char_length(wallet_display_name) <= 80),
  add constraint restaurants_wallet_points_label_length
    check (wallet_points_label is null or char_length(wallet_points_label) <= 28),
  add constraint restaurants_wallet_card_label_length
    check (wallet_card_label is null or char_length(wallet_card_label) <= 28),
  add constraint restaurants_wallet_reward_text_length
    check (wallet_reward_text is null or char_length(wallet_reward_text) <= 90);
