ALTER TABLE public.actual_stop_times
  ADD COLUMN IF NOT EXISTS pax_on integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pax_off integer NOT NULL DEFAULT 0;