-- Backfill / ensure consult_type + title for conversation lock scope.
alter table public.conversations
  add column if not exists consult_type text;

alter table public.conversations
  add column if not exists title text;
