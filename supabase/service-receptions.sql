-- 客服接待历史：谁接待了哪个老板、何时开始/结束。接待关系主锁仍在 conversations.customer_service_id。
create table if not exists public.service_receptions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  boss_id uuid references public.profiles(id),
  customer_service_id uuid not null references public.profiles(id),
  order_id uuid references public.orders(id) on delete set null,
  status text not null default 'active',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists service_receptions_service_started_idx
  on public.service_receptions (customer_service_id, started_at desc);

create index if not exists service_receptions_conversation_active_idx
  on public.service_receptions (conversation_id, status);

create index if not exists service_receptions_boss_idx
  on public.service_receptions (boss_id, started_at desc);
