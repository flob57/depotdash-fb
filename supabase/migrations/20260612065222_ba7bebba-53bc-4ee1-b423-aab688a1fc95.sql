
CREATE TABLE public.correspondence_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  database_id text NOT NULL,
  weekdays smallint[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6,7]::smallint[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, database_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.correspondence_settings TO authenticated;
GRANT ALL ON public.correspondence_settings TO service_role;

ALTER TABLE public.correspondence_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own correspondence settings"
ON public.correspondence_settings FOR ALL TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_correspondence_settings_updated_at
BEFORE UPDATE ON public.correspondence_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
