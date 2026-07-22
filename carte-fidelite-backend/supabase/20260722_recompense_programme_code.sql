-- Code de retrait pour la recompense du programme de fidelite (seuil de
-- points atteint), sur le meme principe que les gains de la roue.

alter table public.clients
  add column if not exists recompense_code_retrait text,
  add column if not exists recompense_valide_du timestamptz,
  add column if not exists recompense_valide_au timestamptz,
  add column if not exists recompense_recuperee_le timestamptz;

create index if not exists clients_recompense_code_idx
  on public.clients(recompense_code_retrait)
  where recompense_code_retrait is not null;
