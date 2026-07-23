-- Reglages de geolocalisation pour les notifications de proximite Wallet
-- (Apple Wallet locations + relevantText, Google Wallet locations sur la
-- classe de fidelite). Stocke en base plutot qu'en variables d'environnement
-- pour que le restaurateur puisse gerer ca lui meme depuis Reglages.

alter table public.restaurants
  add column if not exists geoloc_latitude double precision,
  add column if not exists geoloc_longitude double precision,
  add column if not exists geoloc_message_proximite text,
  add column if not exists geoloc_actif boolean not null default false;
