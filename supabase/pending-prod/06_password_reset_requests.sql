-- PR178 / Auth unify: durable OTP + password-reset request rows.
-- Safe to re-run. Required so serverless isolates do not rely on process memory.

create table if not exists public.password_reset_requests (
  id text primary key,
  account text not null,
  role text not null,
  status text not null default '待处理',
  created_at timestamptz not null default now()
);

create index if not exists password_reset_requests_account_role_created_idx
  on public.password_reset_requests (account, role, created_at desc);

comment on table public.password_reset_requests is
  'Durable OTP / password-reset tokens for auth.users flows (login OTP, forgot password, register OTP).';
