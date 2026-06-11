-- Add Wednesday + Saturday/Holidays Notion DB slots
ALTER TABLE public.user_notion_settings
  ADD COLUMN IF NOT EXISTS services_db_id_wed text,
  ADD COLUMN IF NOT EXISTS services_db_id_sat_hol text;

-- Shared school holidays calendar
CREATE TABLE public.school_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_holidays_dates_chk CHECK (end_date >= start_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_holidays TO authenticated;
GRANT ALL ON public.school_holidays TO service_role;

ALTER TABLE public.school_holidays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view school holidays"
  ON public.school_holidays FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert school holidays"
  ON public.school_holidays FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update school holidays"
  ON public.school_holidays FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete school holidays"
  ON public.school_holidays FOR DELETE TO authenticated USING (true);

CREATE TRIGGER update_school_holidays_updated_at
  BEFORE UPDATE ON public.school_holidays
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX school_holidays_range_idx ON public.school_holidays (start_date, end_date);