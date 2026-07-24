-- Corbeille clients : au lieu d'une suppression immediate et definitive,
-- un client "supprime" est marque deleted_at et reste recuperable 30 jours
-- avant la purge automatique (voir le cron cote serveur).
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_clients_restaurant_deleted_at
  ON public.clients (restaurant_id, deleted_at);
