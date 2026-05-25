ALTER TABLE public.driving_sessions ADD COLUMN IF NOT EXISTS notion_synced_at TIMESTAMPTZ;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS notion_synced_at TIMESTAMPTZ;
ALTER TABLE public.fuel_fillups ADD COLUMN IF NOT EXISTS notion_synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_driving_sessions_notion_unsynced
  ON public.driving_sessions (user_id) WHERE notion_synced_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_shifts_notion_unsynced
  ON public.shifts (user_id) WHERE notion_synced_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_fuel_fillups_notion_unsynced
  ON public.fuel_fillups (user_id) WHERE notion_synced_at IS NULL;