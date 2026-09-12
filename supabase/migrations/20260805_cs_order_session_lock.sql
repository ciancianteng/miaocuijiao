-- Order-scoped CS session ownership (not boss-account permanent lock).
-- customer_service_id on conversations remains the assigned_cs_id.

alter table public.conversations
  add column if not exists consult_type text;

alter table public.conversations
  add column if not exists title text;

alter table public.conversations
  add column if not exists last_active_at timestamptz;

create index if not exists conversations_boss_consult_open_idx
  on public.conversations (boss_id, consult_type, updated_at desc)
  where order_id is null and status not in ('closed', 'ended');

create index if not exists conversations_order_open_idx
  on public.conversations (order_id, updated_at desc)
  where order_id is not null and status not in ('closed', 'ended');

create index if not exists conversations_cs_owner_open_idx
  on public.conversations (customer_service_id, updated_at desc)
  where customer_service_id is not null and status not in ('closed', 'ended');

create table if not exists public.conversation_lock_logs (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.conversations(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  action text not null,
  from_cs_id uuid references public.profiles(id) on delete set null,
  to_cs_id uuid references public.profiles(id) on delete set null,
  operator_id uuid references public.profiles(id) on delete set null,
  operator_role text,
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists conversation_lock_logs_conv_idx
  on public.conversation_lock_logs (conversation_id, created_at desc);

create index if not exists conversation_lock_logs_order_idx
  on public.conversation_lock_logs (order_id, created_at desc);
