-- Permet de suivre l'envoi de l'email de bienvenue differe (1h apres
-- l'inscription), pour ne jamais le renvoyer deux fois au meme client.

alter table public.clients
  add column if not exists email_bienvenue_envoye boolean not null default false;

-- Les clients deja inscrits avant cette fonctionnalite ne doivent pas
-- recevoir un email de bienvenue tardif et hors contexte.
update public.clients
set email_bienvenue_envoye = true
where email_bienvenue_envoye is distinct from true;
