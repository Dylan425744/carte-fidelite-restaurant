-- Suivi des notifications Wallet reellement envoyees a chaque client, pour
-- pouvoir plafonner a 10 notifications par carte client sur 24 heures (et
-- non plus une limite globale par restaurant).

create table if not exists public.notification_envois (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  campagne_id uuid,
  envoye_at timestamptz not null default now()
);

create index if not exists notification_envois_client_recent_idx
  on public.notification_envois(client_id, envoye_at);
