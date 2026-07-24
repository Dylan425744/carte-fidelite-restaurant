-- Messages envoyes depuis le formulaire de contact du centre d'aide
-- (bouton "Besoin d'aide ?" du tableau de bord restaurateur).
CREATE TABLE IF NOT EXISTS public.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid REFERENCES public.restaurants(id) ON DELETE SET NULL,
  restaurant_nom text,
  email text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_messages_created_at
  ON public.support_messages (created_at DESC);
