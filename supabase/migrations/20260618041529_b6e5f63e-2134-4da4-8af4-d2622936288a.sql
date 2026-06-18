
-- SAE feature: store actual passing times + Notion target DB references
ALTER TABLE public.user_notion_settings
  ADD COLUMN IF NOT EXISTS planning_db_id text,
  ADD COLUMN IF NOT EXISTS actual_times_db_id text,
  ADD COLUMN IF NOT EXISTS actual_times_parent_page_id text;

CREATE TABLE IF NOT EXISTS public.actual_stop_times (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  route_notion_id text NOT NULL,
  route_name text NOT NULL,
  stop_index int NOT NULL,
  stop_name text NOT NULL,
  scheduled_time text,           -- "HH:MM"
  actual_time timestamptz NOT NULL DEFAULT now(),
  diff_minutes int,              -- positive = late, negative = early
  status text,                   -- 'early' | 'on_time' | 'late'
  notion_page_id text,
  notion_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, work_date, route_notion_id, stop_index)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.actual_stop_times TO authenticated;
GRANT ALL ON public.actual_stop_times TO service_role;

ALTER TABLE public.actual_stop_times ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage their own actual stop times - select"
  ON public.actual_stop_times FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "users manage their own actual stop times - insert"
  ON public.actual_stop_times FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users manage their own actual stop times - update"
  ON public.actual_stop_times FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users manage their own actual stop times - delete"
  ON public.actual_stop_times FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER trg_actual_stop_times_updated
  BEFORE UPDATE ON public.actual_stop_times
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_actual_stop_times_user_date
  ON public.actual_stop_times (user_id, work_date);
