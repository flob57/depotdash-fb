-- Fuel fill-ups table
CREATE TABLE public.fuel_fillups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  session_id uuid REFERENCES public.driving_sessions(id) ON DELETE SET NULL,
  bus_reference text NOT NULL,
  km_at_fillup integer NOT NULL,
  liters numeric(8,2) NOT NULL,
  filled_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.fuel_fillups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own ff select" ON public.fuel_fillups FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own ff insert" ON public.fuel_fillups FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own ff update" ON public.fuel_fillups FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own ff delete" ON public.fuel_fillups FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_fuel_fillups_user_bus_km ON public.fuel_fillups(user_id, bus_reference, km_at_fillup);

-- Add fuel database id to notion settings
ALTER TABLE public.user_notion_settings
  ADD COLUMN fuel_fillups_db_id text;