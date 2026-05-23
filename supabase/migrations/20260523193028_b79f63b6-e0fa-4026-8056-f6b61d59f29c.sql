CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TABLE public.user_notion_settings (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  shifts_db_id TEXT,
  sessions_db_id TEXT,
  daily_totals_db_id TEXT,
  distance_summary_db_id TEXT,
  timezone TEXT NOT NULL DEFAULT 'Europe/Brussels',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_notion_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own notion settings select" ON public.user_notion_settings
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own notion settings insert" ON public.user_notion_settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own notion settings update" ON public.user_notion_settings
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own notion settings delete" ON public.user_notion_settings
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_user_notion_settings_updated_at
BEFORE UPDATE ON public.user_notion_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();