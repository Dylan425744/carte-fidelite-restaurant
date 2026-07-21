-- Le texte affiche en haut de la carte Apple Wallet doit refleter le nom du
-- restaurant par defaut. "Bravocard" est le nom de la plateforme, pas celui
-- du commerce : ce defaut fige au niveau de la colonne ne doit plus etre
-- applique automatiquement a la creation d'un restaurant.

alter table public.restaurants
  alter column apple_logo_text drop not null,
  alter column apple_logo_text drop default;

-- Les restaurants qui n'ont jamais personnalise ce champ ont encore la
-- valeur historique "Bravocard" : on la retire pour laisser apparaitre leur
-- propre nom (cote application, une valeur vide a deja le meme effet).
update public.restaurants
set apple_logo_text = ''
where apple_logo_text = 'Bravocard';
