-- Historique compact des campagnes Wallet par commerce.
-- Les messages sont servis uniquement par l'API backend authentifiée.

alter table public.restaurants
  add column if not exists last_notification_title text,
  add column if not exists last_notification_message text,
  add column if not exists last_notification_sent_at timestamptz,
  add column if not exists notification_history jsonb not null default '[]'::jsonb,
  add column if not exists notification_sending boolean not null default false;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'restaurants_notification_history_array_check'
  ) then
    alter table public.restaurants
      add constraint restaurants_notification_history_array_check
      check (jsonb_typeof(notification_history) = 'array');
  end if;
end $$;

create index if not exists scans_client_id_idx
  on public.scans (client_id);
