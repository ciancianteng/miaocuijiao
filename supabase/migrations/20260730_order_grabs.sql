alter table public.orders add column if not exists note text;

  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  companion_id uuid not null references public.profiles(id),
  status text not null default 'pending_customer_selection',
  grabbed_at timestamptz not null default now(),
  unique(order_id, companion_id)
);

create index if not exists order_grabs_order_id_idx on public.order_grabs(order_id);
create index if not exists order_grabs_companion_id_idx on public.order_grabs(companion_id);

alter table public.order_grabs enable row level security;

-- Optional conversation typing for order vs general support.
alter table public.conversations add column if not exists conversation_type text;
alter table public.conversations add column if not exists last_message_at timestamptz;
alter table public.conversations add column if not exists last_read_at timestamptz;
alter table public.conversations add column if not exists closed_at timestamptz;
alter table public.conversations add column if not exists closed_by uuid references public.profiles(id);
