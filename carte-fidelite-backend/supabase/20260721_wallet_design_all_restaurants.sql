-- Le studio Apple Wallet et Google Wallet est disponible pour chaque
-- restaurant. La colonne historique reste conservee pour compatibilite avec
-- les versions deja deployees, mais elle ne depend plus du forfait Stripe.

alter table public.restaurants
  alter column apple_pro_design set default true;

update public.restaurants
set apple_pro_design = true
where apple_pro_design is distinct from true;
