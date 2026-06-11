CREATE TABLE public.departure_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notion_page_id text NOT NULL,
  slot_index int NOT NULL,
  weekdays int[] NOT NULL DEFAULT ARRAY[1,2,3,4,5],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, notion_page_id, slot_index)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.departure_overrides TO authenticated;
GRANT ALL ON public.departure_overrides TO service_role;

ALTER TABLE public.departure_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own departure_overrides" ON public.departure_overrides FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own departure_overrides" ON public.departure_overrides FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own departure_overrides" ON public.departure_overrides FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own departure_overrides" ON public.departure_overrides FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER trg_departure_overrides_updated_at BEFORE UPDATE ON public.departure_overrides
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();