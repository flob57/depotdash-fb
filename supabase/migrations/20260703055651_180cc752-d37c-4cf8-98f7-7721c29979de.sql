ALTER TABLE public.user_notion_settings
  ADD COLUMN IF NOT EXISTS parking_db_id TEXT;