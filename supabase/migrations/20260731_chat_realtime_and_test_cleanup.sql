-- Enable Realtime for chat tables (idempotent).
do $$
begin
  begin
    alter publication supabase_realtime add table public.messages;
  exception
    when duplicate_object then null;
    when undefined_object then null;
    when others then null;
  end;
  begin
    alter publication supabase_realtime add table public.conversations;
  exception
    when duplicate_object then null;
    when undefined_object then null;
    when others then null;
  end;
end $$;

-- Soft-close noisy automated / garbled test conversations so CS ops list stays clean.
update public.conversations c
set
  status = 'closed',
  closed_at = coalesce(c.closed_at, now()),
  updated_at = now()
where coalesce(c.status, '') not in ('closed', 'ended')
  and (
    exists (
      select 1
      from public.messages m
      where m.conversation_id = c.id
        and (
          m.content ~* '(\[TEST\]|E2E-MSG|E2E[_-]|CHAT-|CS-LINK|SVC-|MSG-|ORDER-CHAT-|acceptance|自动化测试)'
          or m.content ~ '(Ã.|Â.|ä¸|æ.|ðŸ)'
        )
    )
    or exists (
      select 1
      from public.orders o
      where o.id = c.order_id
        and o.order_no ~* '(\[TEST\]|E2E|CHAT-|CS-LINK|TEST-)'
    )
  );
