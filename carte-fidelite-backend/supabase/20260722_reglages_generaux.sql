-- Page "Reglages" : informations generales centralisees du restaurant.
-- Ces champs servent de valeur par defaut pour les endroits plus specifiques
-- (Wallet, roue, kit de communication) quand ceux-ci n'ont pas ete personnalises
-- individuellement. Une personnalisation specifique existante n'est jamais
-- ecrasee par ces valeurs generales.

alter table public.restaurants
  add column if not exists telephone text,
  add column if not exists adresse text,
  add column if not exists email_public text,
  add column if not exists site_web text,
  add column if not exists logo_url text,
  add column if not exists couleur_principale text,
  add column if not exists couleur_secondaire text;

-- Une valeur peut coincider avec le defaut par hasard (ex: le restaurateur
-- choisit vraiment 100 points). Ces indicateurs retiennent qu'une section a
-- ete reellement enregistree au moins une fois depuis Reglages, plutot que
-- de deviner a partir de la valeur seule.
alter table public.restaurants
  add column if not exists reglages_identite_confirme boolean not null default false,
  add column if not exists reglages_contact_confirme boolean not null default false,
  add column if not exists reglages_programme_confirme boolean not null default false,
  add column if not exists reglages_avis_confirme boolean not null default false;
