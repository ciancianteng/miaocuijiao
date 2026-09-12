-- Companion notification read receipts + companion_support conversation indexing
alter table public.conversations add column if not exists conversation_type text;
alter table public.conversations add column if not exists last_message_at timestamptz;
alter table public.conversations add column if not exists last_read_at timestamptz;

create table if not exists public.companion_notification_reads (
  companion_id uuid not null references public.profiles(id) on delete cascade,
  notice_key text not null,
  read_at timestamptz not null default now(),
  primary key (companion_id, notice_key)
);

create index if not exists idx_companion_notification_reads_companion
  on public.companion_notification_reads(companion_id, read_at desc);

alter table public.companion_notification_reads enable row level security;

do $$ begin
  create policy "companion_notification_reads_self"
    on public.companion_notification_reads for all
    using (auth.uid() = companion_id)
    with check (auth.uid() = companion_id);
exception when duplicate_object then null; end $$;

grant select, insert, update, delete on public.companion_notification_reads to authenticated;
grant all on public.companion_notification_reads to service_role;

create index if not exists idx_conversations_companion_type
  on public.conversations(companion_id, conversation_type, updated_at desc);
