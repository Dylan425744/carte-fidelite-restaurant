-- Personnalisation Apple Wallet par commerce.
-- Le code d'accès commerçant n'est jamais stocké en clair.

alter table public.restaurants
  add column if not exists slug text,
  add column if not exists actif boolean not null default true,
  add column if not exists design_enabled boolean not null default true,
  add column if not exists design_access_token_hash text,
  add column if not exists apple_pro_design boolean not null default false,
  add column if not exists apple_color_preset text not null default 'dark',
  add column if not exists apple_logo_text text not null default 'Bravocard',
  add column if not exists apple_points_label text not null default 'POINTS FIDÉLITÉ',
  add column if not exists apple_card_label text not null default 'FIDÉLITÉ',
  add column if not exists apple_custom_color text,
  add column if not exists apple_logo_url text,
  add column if not exists apple_strip_url text,
  add column if not exists apple_icon_url text,
  add column if not exists design_updated_at timestamptz;

create unique index if not exists restaurants_slug_unique
  on public.restaurants (slug)
  where slug is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'restaurants_apple_color_preset_check'
  ) then
    alter table public.restaurants
      add constraint restaurants_apple_color_preset_check
      check (apple_color_preset in ('dark', 'blue', 'green', 'red', 'purple', 'orange'));
  end if;
end $$;

insert into public.restaurants (
  nom,
  slug,
  seuil_recompense,
  description_recompense,
  apple_color_preset
)
select 'Chez Basile', 'chez-basile', 100, 'Un menu offert', 'dark'
where not exists (
  select 1 from public.restaurants where slug = 'chez-basile'
);

alter table public.clients
  add column if not exists restaurant_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clients_restaurant_id_fkey'
  ) then
    alter table public.clients
      add constraint clients_restaurant_id_fkey
      foreign key (restaurant_id)
      references public.restaurants(id)
      on delete set null;
  end if;
end $$;

update public.clients
set restaurant_id = (
  select id from public.restaurants where slug = 'chez-basile' limit 1
)
where restaurant_id is null;

create index if not exists clients_restaurant_id_idx
  on public.clients (restaurant_id);
