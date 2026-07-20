-- Editeur Wallet WYSIWYG : separation complete des images Apple et Google.
-- Avant cette migration, Google Wallet reutilisait silencieusement les
-- colonnes apple_logo_url et apple_strip_url. Chaque plateforme a maintenant
-- ses propres colonnes, pour ne jamais melanger leurs images ni leurs regles.

alter table public.restaurants
  add column if not exists google_program_logo_url text,
  add column if not exists google_wide_logo_url text,
  add column if not exists google_hero_image_url text;

-- Reprise des visuels deja configures, pour ne rien casser au deploiement :
-- les restaurants ayant deja un logo/une banniere Apple gardent le meme rendu
-- Google tant que le restaurateur n'a pas explicitement choisi des visuels
-- Google dedies dans le nouvel editeur.
update public.restaurants
set google_program_logo_url = apple_logo_url
where apple_logo_url is not null and google_program_logo_url is null;

update public.restaurants
set google_hero_image_url = apple_strip_url
where apple_strip_url is not null and google_hero_image_url is null;
