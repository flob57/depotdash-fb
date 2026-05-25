
-- Declared hours
CREATE TABLE public.declared_hours (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  work_date DATE NOT NULL,
  minutes INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, work_date)
);
ALTER TABLE public.declared_hours ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own dh select" ON public.declared_hours FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own dh insert" ON public.declared_hours FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own dh update" ON public.declared_hours FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own dh delete" ON public.declared_hours FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER update_declared_hours_updated_at BEFORE UPDATE ON public.declared_hours
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Starting balances (one row per user)
CREATE TABLE public.user_balance_settings (
  user_id UUID NOT NULL PRIMARY KEY,
  starting_overtime_minutes INTEGER NOT NULL DEFAULT 0,
  starting_cp_n_minus_1 NUMERIC NOT NULL DEFAULT 0,
  starting_cp_n NUMERIC NOT NULL DEFAULT 0,
  starting_balance_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.user_balance_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own bal select" ON public.user_balance_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own bal insert" ON public.user_balance_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own bal update" ON public.user_balance_settings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own bal delete" ON public.user_balance_settings FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER update_user_balance_settings_updated_at BEFORE UPDATE ON public.user_balance_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Extend public_holidays with kind
ALTER TABLE public.public_holidays
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'holiday' CHECK (kind IN ('holiday', 'paid_leave'));
