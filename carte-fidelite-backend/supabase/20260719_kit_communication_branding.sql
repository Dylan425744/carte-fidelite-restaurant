-- Personnalisation du Kit de communication (stickers, chevalets, affiches) : identite
-- visuelle du restaurant reutilisee par tous les supports imprimables generes a la demande.
-- Les fichiers eux-memes ne sont pas stockes : ils sont generes a chaque telechargement
-- (SVG/PNG/PDF), donc aucune table ni bucket de stockage supplementaire n'est necessaire ici.

alter table public.restaurants
  add column if not exists communication_primary_color text,
  add column if not exists communication_secondary_color text,
  add column if not exists communication_theme text not null default 'premium-violet',
  add column if not exists communication_logo_url text,
  add column if not exists reward_title text,
  add column if not exists reward_description text,
  add column if not exists always_winner boolean not null default false;

alter table public.restaurants
  drop constraint if exists restaurants_communication_theme_check;

alter table public.restaurants
  add constraint restaurants_communication_theme_check check (
    communication_theme in ('premium-violet', 'ludique-cadeau')
  );

-- lien_avis_google existe deja en base (utilise par marketingAssetsService.js et le
-- second QR code "avis Google") mais n'avait jamais ete cree par une migration tracee.
-- Cette ligne est un simple filet de securite, sans effet si la colonne existe deja.
alter table public.restaurants
  add column if not exists lien_avis_google text;
