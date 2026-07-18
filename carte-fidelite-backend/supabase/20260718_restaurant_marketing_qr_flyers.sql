-- Supports marketing propres a chaque restaurant : lien QR permanent et fichiers generes.

alter table public.restaurants
  add column if not exists public_qr_token text,
  add column if not exists marketing_assets_status text not null default 'pending',
  add column if not exists marketing_assets_version integer not null default 1,
  add column if not exists qr_svg_path text,
  add column if not exists qr_png_path text,
  add column if not exists flyer_pdf_path text,
  add column if not exists marketing_assets_updated_at timestamptz,
  add column if not exists marketing_assets_error text;

update public.restaurants
set public_qr_token = encode(gen_random_bytes(18), 'hex')
where public_qr_token is null;

alter table public.restaurants
  alter column public_qr_token set default encode(gen_random_bytes(18), 'hex'),
  alter column public_qr_token set not null;

alter table public.restaurants
  drop constraint if exists restaurants_marketing_assets_status_check;

alter table public.restaurants
  add constraint restaurants_marketing_assets_status_check check (
    marketing_assets_status in ('pending', 'generating', 'ready', 'error')
  );

alter table public.restaurants
  drop constraint if exists restaurants_marketing_assets_version_check;

alter table public.restaurants
  add constraint restaurants_marketing_assets_version_check check (
    marketing_assets_version >= 1
  );

create unique index if not exists restaurants_public_qr_token_unique
  on public.restaurants (public_qr_token);

create index if not exists restaurants_marketing_assets_status_idx
  on public.restaurants (marketing_assets_status, marketing_assets_updated_at);

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
)
values (
  'restaurant-marketing',
  'restaurant-marketing',
  true,
  10485760,
  array['image/svg+xml', 'image/png', 'application/pdf']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
