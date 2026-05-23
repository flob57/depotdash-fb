
-- Profiles
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "Users view own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users update own profile" on public.profiles for update using (auth.uid() = id);
create policy "Users insert own profile" on public.profiles for insert with check (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', new.email));
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Shifts
create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  on_duty_at timestamptz not null default now(),
  off_duty_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);
alter table public.shifts enable row level security;
create policy "own shifts select" on public.shifts for select using (auth.uid() = user_id);
create policy "own shifts insert" on public.shifts for insert with check (auth.uid() = user_id);
create policy "own shifts update" on public.shifts for update using (auth.uid() = user_id);
create policy "own shifts delete" on public.shifts for delete using (auth.uid() = user_id);
create index shifts_user_on_duty_idx on public.shifts(user_id, on_duty_at desc);

-- Driving sessions
create table public.driving_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  shift_id uuid references public.shifts on delete set null,
  start_at timestamptz not null default now(),
  end_at timestamptz,
  km_start integer,
  km_end integer,
  created_at timestamptz not null default now()
);
alter table public.driving_sessions enable row level security;
create policy "own ds select" on public.driving_sessions for select using (auth.uid() = user_id);
create policy "own ds insert" on public.driving_sessions for insert with check (auth.uid() = user_id);
create policy "own ds update" on public.driving_sessions for update using (auth.uid() = user_id);
create policy "own ds delete" on public.driving_sessions for delete using (auth.uid() = user_id);
create index ds_user_start_idx on public.driving_sessions(user_id, start_at desc);
