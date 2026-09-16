-- Full-site perf Phase 1: correct / missing indexes (idempotent + column-safe).
-- Prior 20260802_perf_indexes.sql targeted public.chat_messages (wrong table).
-- Live chat SoT is public.messages.

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'messages'
  ) then
    create index if not exists messages_conversation_created_idx
      on public.messages (conversation_id, created_at desc);
    create index if not exists messages_conversation_id_idx
      on public.messages (conversation_id);
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'transactions'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'transactions' and column_name = 'user_id'
  ) then
    create index if not exists transactions_user_created_idx
      on public.transactions (user_id, created_at desc);
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'transactions' and column_name = 'transaction_type'
  ) then
    create index if not exists transactions_type_created_idx
      on public.transactions (transaction_type, created_at desc);
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'companion_reviews'
  ) then
    create index if not exists companion_reviews_companion_created_idx
      on public.companion_reviews (companion_id, created_at desc);
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'companion_reviews' and column_name = 'status'
    ) then
      create index if not exists companion_reviews_status_created_idx
        on public.companion_reviews (status, created_at desc);
    end if;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'boss_notifications'
  ) then
    create index if not exists boss_notifications_boss_created_idx
      on public.boss_notifications (boss_id, created_at desc);
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'content_ack_records'
  ) then
    create index if not exists content_ack_records_user_id_idx
      on public.content_ack_records (user_id);
  end if;
end $$;
