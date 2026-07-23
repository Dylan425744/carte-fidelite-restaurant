ALTER TABLE public.fraud_settings
  DROP CONSTRAINT fraud_settings_cooldown_minutes_check;

ALTER TABLE public.fraud_settings
  ADD CONSTRAINT fraud_settings_cooldown_minutes_check
  CHECK (cooldown_minutes >= 0 AND cooldown_minutes <= 1440);
