ALTER TABLE public.user_notion_settings
  ADD COLUMN IF NOT EXISTS sae_lmjv_db_id TEXT,
  ADD COLUMN IF NOT EXISTS sae_mercredi_db_id TEXT;