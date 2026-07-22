-- La table est uniquement utilisee par le backend Bravocard.
-- RLS + revocation empechent une lecture directe des journaux par le navigateur.
alter table public.notification_envois enable row level security;
revoke all on table public.notification_envois from anon, authenticated;

create index if not exists notification_envois_restaurant_id_idx
  on public.notification_envois (restaurant_id);

create index if not exists restaurants_billing_owner_user_id_idx
  on public.restaurants (billing_owner_user_id)
  where billing_owner_user_id is not null;

create index if not exists restaurants_deleted_by_idx
  on public.restaurants (deleted_by)
  where deleted_by is not null;
