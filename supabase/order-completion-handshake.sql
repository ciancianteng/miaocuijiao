-- Optional completion handshake columns (safe to re-run)
alter table public.orders add column if not exists completion_method text not null default '';
alter table public.orders add column if not exists completion_requested_at timestamptz;

notify pgrst, 'reload schema';
