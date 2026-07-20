-- Personnalisation de la roue des cadeaux par restaurant (lots + couleurs), acces
-- a la roue via un second parcours "QR avis" independant du scan en caisse, et
-- code de retrait pour que le personnel verifie un cadeau au comptoir (le lien
-- de confirmation envoye par email pointait vers une page cadeau.html qui
-- n'a jamais ete creee : le parcours etait casse depuis le debut).

alter table public.restaurants
  add column if not exists roue_lots jsonb,
  add column if not exists roue_couleur_principale text,
  add column if not exists roue_couleur_secondaire text;

alter table public.scans
  add column if not exists code_retrait text,
  add column if not exists code_retrait_utilise_le timestamptz;

create unique index if not exists scans_code_retrait_unique
  on public.scans (code_retrait) where code_retrait is not null;

-- Un tour "QR avis" n'est pas lie a un scan en caisse : on cree un enregistrement
-- dedie, retrouve ensuite par un cookie anti-abus (un tour par navigateur et par
-- jour) et par un code de retrait a presenter au comptoir.
create table if not exists public.roue_avis_entries (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  cookie_id text not null,
  cadeau_gagne text not null,
  cadeau_icone text not null,
  cadeau_valide_du timestamptz not null,
  cadeau_valide_au timestamptz not null,
  code_retrait text not null,
  utilise boolean not null default false,
  utilise_le timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists roue_avis_entries_code_retrait_unique
  on public.roue_avis_entries (code_retrait);

create index if not exists roue_avis_entries_restaurant_cookie_idx
  on public.roue_avis_entries (restaurant_id, cookie_id, created_at);

-- Meme convention que les autres tables du projet : usage exclusif par le
-- backend service_role, aucun acces direct anon/authenticated.
alter table public.roue_avis_entries enable row level security;
revoke all on table public.roue_avis_entries from anon, authenticated;
