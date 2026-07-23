-- Distingue une position GPS calculee automatiquement depuis l'adresse
-- (Reglages > Contact) d'une position que le restaurateur a lui meme
-- confirmee ou modifiee dans Reglages > Geolocalisation. Tant que ce
-- drapeau est faux, un changement d'adresse recalcule automatiquement
-- la position ; des qu'il passe a vrai, on ne l'ecrase plus jamais tout seul.

alter table public.restaurants
  add column if not exists geoloc_coordonnees_manuelles boolean not null default false;
