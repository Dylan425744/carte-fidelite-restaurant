alter table public.restaurants
  add column if not exists wallet_barcode_format text not null default 'CODE_128',
  add column if not exists secondary_qr_svg_path text,
  add column if not exists secondary_qr_png_path text;

alter table public.restaurants
  drop constraint if exists restaurants_wallet_barcode_format_check;

alter table public.restaurants
  add constraint restaurants_wallet_barcode_format_check
  check (wallet_barcode_format in ('CODE_128', 'QR_CODE'));
