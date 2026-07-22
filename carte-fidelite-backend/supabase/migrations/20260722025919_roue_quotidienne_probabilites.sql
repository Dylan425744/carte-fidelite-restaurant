-- Une participation maximum par jour civil en France. Les trois index
-- protegent respectivement le navigateur, le client identifie et l'adresse
-- email, y compris si deux requetes arrivent exactement en meme temps.
create unique index if not exists roue_avis_entries_cookie_day_uidx
  on public.roue_avis_entries (
    restaurant_id,
    cookie_id,
    ((created_at at time zone 'Europe/Paris')::date)
  );

create unique index if not exists roue_avis_entries_client_day_uidx
  on public.roue_avis_entries (
    restaurant_id,
    client_id,
    ((created_at at time zone 'Europe/Paris')::date)
  )
  where client_id is not null;

create unique index if not exists roue_avis_entries_email_day_uidx
  on public.roue_avis_entries (
    restaurant_id,
    email_destinataire,
    ((created_at at time zone 'Europe/Paris')::date)
  )
  where email_destinataire is not null;
