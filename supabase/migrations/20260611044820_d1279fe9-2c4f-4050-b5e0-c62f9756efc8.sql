CREATE TABLE public.duties (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  start_time TIME NOT NULL,
  qub TEXT NOT NULL DEFAULT '',
  driver TEXT NOT NULL DEFAULT '',
  route TEXT NOT NULL DEFAULT '',
  vehicle TEXT NOT NULL DEFAULT '',
  weekdays SMALLINT[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::SMALLINT[],
  last_checked_date DATE,
  notion_page_id TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, notion_page_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.duties TO authenticated;
GRANT ALL ON public.duties TO service_role;

ALTER TABLE public.duties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own duties" ON public.duties FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own duties" ON public.duties FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own duties" ON public.duties FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own duties" ON public.duties FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER update_duties_updated_at BEFORE UPDATE ON public.duties
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX duties_user_start_idx ON public.duties (user_id, start_time);

ALTER TABLE public.user_notion_settings ADD COLUMN IF NOT EXISTS services_db_id TEXT;