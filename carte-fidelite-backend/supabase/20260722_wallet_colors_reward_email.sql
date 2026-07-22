-- Separe strictement les couleurs Apple Wallet et Google Wallet, puis permet
-- au parcours QR avis/roue d'envoyer le code cadeau au bon client.

alter table public.restaurants
  add column if not exists google_custom_color text;

update public.restaurants
set google_custom_color = apple_custom_color
where google_custom_color is null
  and apple_custom_color is not null;

alter table public.restaurants
  drop constraint if exists restaurants_google_custom_color_check;

alter table public.restaurants
  add constraint restaurants_google_custom_color_check
  check (google_custom_color is null or google_custom_color ~ '^#[0-9A-F]{6}$');

-- Un resultat perdant n'a ni code ni periode de retrait. Ces trois colonnes
-- doivent donc accepter NULL, contrairement a la migration initiale.
alter table public.roue_avis_entries
  alter column cadeau_valide_du drop not null,
  alter column cadeau_valide_au drop not null,
  alter column code_retrait drop not null,
  add column if not exists client_id uuid references public.clients(id) on delete set null,
  add column if not exists email_destinataire text;

alter table public.roue_avis_entries
  drop constraint if exists roue_avis_entries_email_destinataire_check;

alter table public.roue_avis_entries
  add constraint roue_avis_entries_email_destinataire_check
  check (
    email_destinataire is null
    or (email_destinataire = lower(email_destinataire) and char_length(email_destinataire) <= 254)
  );

create index if not exists roue_avis_entries_client_created_idx
  on public.roue_avis_entries (client_id, created_at desc)
  where client_id is not null;
