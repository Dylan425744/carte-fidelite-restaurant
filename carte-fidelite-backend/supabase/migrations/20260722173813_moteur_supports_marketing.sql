-- Réglages du générateur marketing, isolés par restaurant et par parcours.
-- Les assets lourds restent dans Storage/public ; seuls les choix éditoriaux
-- sont conservés ici afin de ne pas dupliquer les QR codes ni les exports.
alter table public.restaurants
  add column if not exists communication_generator_settings jsonb not null default '{}'::jsonb;

alter table public.restaurants
  drop constraint if exists restaurants_communication_generator_settings_object;

alter table public.restaurants
  add constraint restaurants_communication_generator_settings_object
  check (jsonb_typeof(communication_generator_settings) = 'object');

comment on column public.restaurants.communication_generator_settings is
  'Réglages versionnés du générateur de supports, séparés entre wallet et wheel.';
