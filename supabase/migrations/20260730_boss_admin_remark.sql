-- Boss admin remark field (run in Supabase SQL Editor if missing)
alter table public.profiles add column if not exists remark text not null default '';
alter table public.profiles add column if not exists last_login_at timestamptz;
