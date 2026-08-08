-- P0: Isolate boss↔CS vs companion↔CS conversations
-- Companions must never SELECT boss order_support / general_support rooms,
-- even when companion_id was historically stamped onto those rows.

-- 1) Detach companions from boss↔CS rooms (ACL field misuse).
update public.conversations
set companion_id = null,
    updated_at = now()
where boss_id is not null
  and companion_id is not null
  and coalesce(conversation_type, 'order_support') in ('order_support', 'general_support', '');

-- 2) Ensure companion-only rows are typed as companion_support when possible.
update public.conversations
set conversation_type = 'companion_support',
    updated_at = now()
where companion_id is not null
  and boss_id is null
  and (conversation_type is null or btrim(conversation_type) = '');

-- 3) Replace RLS policies with type-aware isolation.
do $$ begin
  drop policy if exists "conversations_role_read" on public.conversations;
exception when undefined_object then null; end $$;

do $$ begin
  create policy "conversations_role_read" on public.conversations for select using (
    public.mcj_current_role() in ('customer_service', 'admin')
    or customer_service_id = auth.uid()
    or (
      boss_id = auth.uid()
      and coalesce(conversation_type, 'order_support') in ('order_support', 'general_support')
    )
    or (
      companion_id = auth.uid()
      and (
        conversation_type = 'companion_support'
        or (boss_id is null and coalesce(conversation_type, '') not in ('order_support', 'general_support'))
      )
    )
  );
exception when duplicate_object then null; end $$;

do $$ begin
  drop policy if exists "messages_role_read" on public.messages;
exception when undefined_object then null; end $$;

do $$ begin
  create policy "messages_role_read" on public.messages for select using (
    exists (
      select 1
      from public.conversations c
      where c.id = conversation_id
        and (
          public.mcj_current_role() in ('customer_service', 'admin')
          or c.customer_service_id = auth.uid()
          or (
            c.boss_id = auth.uid()
            and coalesce(c.conversation_type, 'order_support') in ('order_support', 'general_support')
          )
          or (
            c.companion_id = auth.uid()
            and (
              c.conversation_type = 'companion_support'
              or (c.boss_id is null and coalesce(c.conversation_type, '') not in ('order_support', 'general_support'))
            )
          )
        )
    )
  );
exception when duplicate_object then null; end $$;

-- Helpful indexes for side-scoped lookups.
create index if not exists conversations_boss_order_support_idx
  on public.conversations (boss_id, order_id, updated_at desc)
  where coalesce(conversation_type, 'order_support') in ('order_support', 'general_support');

create index if not exists conversations_companion_support_idx
  on public.conversations (companion_id, order_id, updated_at desc)
  where conversation_type = 'companion_support' or (boss_id is null and companion_id is not null);
