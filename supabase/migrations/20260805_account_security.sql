-- Account security flags on profiles (passwords remain in Supabase Auth only)
alter table public.profiles add column if not exists has_password boolean not null default false;
alter table public.profiles add column if not exists password_set_at timestamptz;
alter table public.profiles add column if not exists must_change_password boolean not null default false;
alter table public.profiles add column if not exists last_login_at timestamptz;
alter table public.profiles add column if not exists last_login_ip text;

comment on column public.profiles.has_password is 'Whether user has set a login password (never store plaintext/hash here)';
comment on column public.profiles.password_set_at is 'Last time password was set or reset';
comment on column public.profiles.must_change_password is 'Admin-forced password change on next login';
