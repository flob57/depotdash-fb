CREATE TABLE public.public_holidays (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  holiday_date DATE NOT NULL,
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, holiday_date)
);

ALTER TABLE public.public_holidays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own ph select" ON public.public_holidays FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own ph insert" ON public.public_holidays FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own ph update" ON public.public_holidays FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own ph delete" ON public.public_holidays FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_public_holidays_user_date ON public.public_holidays(user_id, holiday_date);