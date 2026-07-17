-- Passage à l'échelle 10 points par visite / récompense à 100 points.
-- La progression existante est multipliée par 10 pour ne léser aucun client.

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'restaurants'
      and column_name = 'points_per_scan'
  ) then
    alter table public.restaurants
      add column points_per_scan integer not null default 10
      check (points_per_scan between 1 and 500);

    update public.clients
    set points = coalesce(points, 0) * 10;

    update public.scans
    set points_ajoutes = coalesce(points_ajoutes, 0) * 10;
  end if;
end $$;

update public.restaurants
set seuil_recompense = 100,
    points_per_scan = 10;

update public.restaurants
set apple_points_label = 'POINTS SUR 100'
where apple_points_label is null
   or upper(apple_points_label) = 'POINTS FIDÉLITÉ';

alter table public.clients
  add column if not exists scan_code text;

update public.clients
set scan_code = 'BC' || upper(substr(md5(id::text), 1, 10))
where scan_code is null;

alter table public.clients
  alter column scan_code set default (
    'BC' || upper(substr(md5(gen_random_uuid()::text), 1, 10))
  );

alter table public.clients
  alter column scan_code set not null;

create unique index if not exists clients_scan_code_unique_idx
  on public.clients (scan_code);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clients_scan_code_format_check'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_scan_code_format_check
      check (scan_code ~ '^BC[A-F0-9]{10}$');
  end if;
end $$;
