CREATE TABLE public.departures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notion_page_id text,
  slot_index int NOT NULL DEFAULT 1,
  start_time time NOT NULL,
  route text NOT NULL DEFAULT '',
  qub text NOT NULL DEFAULT '',
  driver text NOT NULL DEFAULT '',
  vehicle text NOT NULL DEFAULT '',
  weekdays int[] NOT NULL DEFAULT ARRAY[1,2,3,4,5],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.departures TO authenticated;
GRANT ALL ON public.departures TO service_role;

ALTER TABLE public.departures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own departures" ON public.departures FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own departures" ON public.departures FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own departures" ON public.departures FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own departures" ON public.departures FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX departures_user_time_idx ON public.departures(user_id, start_time);

CREATE TRIGGER trg_departures_updated_at BEFORE UPDATE ON public.departures
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();