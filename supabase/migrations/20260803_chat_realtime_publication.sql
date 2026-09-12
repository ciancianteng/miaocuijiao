-- Ensure chat tables are in supabase_realtime (idempotent).
-- Companion ↔ CS realtime requires messages + conversations publication.

do $$
begin
  begin
    alter publication supabase_realtime add table public.messages;
  exception
    when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.conversations;
  exception
    when duplicate_object then null;
  end;
end $$;

alter table public.messages replica identity full;
alter table public.conversations replica identity full;
