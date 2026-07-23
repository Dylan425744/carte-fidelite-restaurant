-- Niveaux VIP (Bronze / Argent / Or), bases sur le total de points gagnes
-- depuis toujours par le client (jamais remis a zero, contrairement au
-- solde utilisable qui repart a 0 a chaque recompense recuperee).
--
-- Le restaurateur peut activer independamment :
--  - un avantage manuel (texte libre applique par l'equipe au comptoir) ;
--  - un bonus automatique (multiplicateur de points selon le niveau).
-- Les deux peuvent etre actifs en meme temps.

alter table public.restaurants
  add column if not exists vip_actif boolean not null default false,
  add column if not exists vip_seuil_argent integer,
  add column if not exists vip_seuil_or integer,
  add column if not exists vip_avantage_manuel_actif boolean not null default false,
  add column if not exists vip_avantage_argent text,
  add column if not exists vip_avantage_or text,
  add column if not exists vip_bonus_actif boolean not null default false,
  add column if not exists vip_multiplicateur_argent numeric(3,2),
  add column if not exists vip_multiplicateur_or numeric(3,2);

alter table public.clients
  add column if not exists points_cumules integer not null default 0;

-- Pour les comptes deja actifs, le cumul demarre au solde actuel plutot
-- que de zero : personne ne doit repartir de rien le jour du lancement.
update public.clients set points_cumules = greatest(points, 0) where points_cumules = 0;
