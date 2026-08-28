-- Optional reception timestamp on conversations (CS accept flow).
alter table public.conversations add column if not exists accepted_at timestamptz;
alter table public.conversations add column if not exists last_read_at timestamptz;
