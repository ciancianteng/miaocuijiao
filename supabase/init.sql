create extension if not exists pgcrypto;

do $$ begin
  create type public.mcj_user_role as enum ('boss', 'companion', 'customer_service', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.mcj_account_status as enum ('active', 'disabled', 'pending');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.mcj_order_status as enum ('awaiting_payment', 'pending', 'claimed', 'waiting_boss_confirm', 'confirmed', 'in_progress', 'completed', 'cancelled', 'refund_requested', 'refunded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.mcj_message_type as enum ('text', 'order_card', 'system');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.mcj_transaction_type as enum ('recharge', 'payment', 'companion_income', 'refund', 'salary', 'withdrawal');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.mcj_report_status as enum ('pending', 'approved', 'rejected', 'paid');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.mcj_user_role not null default 'boss',
  display_name text not null default '',
  email text not null default '',
  phone text not null default '',
  avatar_url text not null default '',
  status public.mcj_account_status not null default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists public.companion_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  nickname text not null default '',
  game text not null default '',
  level_name text not null default '',
  price numeric(10,2) not null default 0,
  commission_rate numeric(5,2) not null default 0,
  deposit_status text not null default 'pending',
  verification_status text not null default 'pending',
  online_status text not null default 'offline',
  description text not null default '',
  voice_url text not null default '',
  card_image_url text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique,
  boss_id uuid not null references public.profiles(id),
  companion_id uuid references public.profiles(id),
  customer_service_id uuid references public.profiles(id),
  order_type text not null default 'custom',
  game text not null default '',
  title text not null default '',
  description text not null default '',
  hours numeric(8,2) not null default 1,
  unit_price numeric(10,2) not null default 0,
  total_amount numeric(10,2) not null default 0,
  status public.mcj_order_status not null default 'awaiting_payment',
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  boss_id uuid references public.profiles(id),
  companion_id uuid references public.profiles(id),
  customer_service_id uuid references public.profiles(id),
  order_id uuid references public.orders(id) on delete cascade,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  sender_role public.mcj_user_role not null,
  message_type public.mcj_message_type not null default 'text',
  content text not null default '',
  order_id uuid references public.orders(id),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  order_id uuid references public.orders(id),
  transaction_type public.mcj_transaction_type not null,
  amount numeric(10,2) not null default 0,
  status text not null default 'pending',
  note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.banners (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  subtitle text not null default '',
  image_url text not null default '',
  button_text text not null default '',
  button_link text not null default '',
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  content text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_service_reports (
  id uuid primary key default gen_random_uuid(),
  customer_service_id uuid not null references public.profiles(id),
  report_date date not null,
  shift_start timestamptz,
  shift_end timestamptz,
  orders_handled integer not null default 0,
  salary_amount numeric(10,2) not null default 0,
  note text not null default '',
  status public.mcj_report_status not null default 'pending',
  admin_note text not null default '',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists idx_profiles_role_status on public.profiles(role, status);
create index if not exists idx_companion_profiles_user_id on public.companion_profiles(user_id);
create index if not exists idx_orders_boss_id on public.orders(boss_id);
create index if not exists idx_orders_companion_id on public.orders(companion_id);
create index if not exists idx_orders_customer_service_id on public.orders(customer_service_id);
create index if not exists idx_orders_status_created_at on public.orders(status, created_at desc);
create index if not exists idx_messages_conversation_created_at on public.messages(conversation_id, created_at);
create index if not exists idx_banners_active_sort on public.banners(is_active, sort_order);
create index if not exists idx_announcements_active_created_at on public.announcements(is_active, created_at desc);

alter table public.profiles enable row level security;
alter table public.companion_profiles enable row level security;
alter table public.orders enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.transactions enable row level security;
alter table public.banners enable row level security;
alter table public.announcements enable row level security;
alter table public.customer_service_reports enable row level security;

do $$ begin
  create policy "profiles_self_read" on public.profiles for select using (auth.uid() = id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "active_banners_public_read" on public.banners for select using (is_active = true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "active_announcements_public_read" on public.announcements for select using (is_active = true);
exception when duplicate_object then null; end $$;

-- Admin/service-role server APIs perform writes with SUPABASE_SERVICE_ROLE_KEY.
-- Do not expose SUPABASE_SERVICE_ROLE_KEY in browser code.




-- V1上线最小权限策略：四端数据隔离。
create or replace function public.mcj_current_role()
returns text
language sql
security definer
set search_path = public
as $$
  select coalesce((select role::text from public.profiles where id = auth.uid()), 'anonymous')
$$;

do $$ begin
  create policy "profiles_admin_read" on public.profiles for select using (public.mcj_current_role() in ('admin','customer_service'));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "companion_profiles_public_read_approved" on public.companion_profiles for select using (verification_status = 'approved' and exists (select 1 from public.profiles p where p.id = user_id and p.status = 'active'));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "companion_profiles_self_update" on public.companion_profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "orders_role_read" on public.orders for select using (
    boss_id = auth.uid()
    or companion_id = auth.uid()
    or customer_service_id = auth.uid()
    or public.mcj_current_role() in ('customer_service','admin')
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "conversations_role_read" on public.conversations for select using (
    boss_id = auth.uid()
    or companion_id = auth.uid()
    or customer_service_id = auth.uid()
    or public.mcj_current_role() in ('customer_service','admin')
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "messages_role_read" on public.messages for select using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id
      and (
        c.boss_id = auth.uid()
        or c.companion_id = auth.uid()
        or c.customer_service_id = auth.uid()
        or public.mcj_current_role() in ('customer_service','admin')
      )
    )
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "transactions_role_read" on public.transactions for select using (user_id = auth.uid() or public.mcj_current_role() = 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "reports_role_read" on public.customer_service_reports for select using (customer_service_id = auth.uid() or public.mcj_current_role() = 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "reports_service_insert" on public.customer_service_reports for insert with check (customer_service_id = auth.uid() and public.mcj_current_role() = 'customer_service');
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "banners_admin_all" on public.banners for all using (public.mcj_current_role() = 'admin') with check (public.mcj_current_role() = 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "announcements_admin_all" on public.announcements for all using (public.mcj_current_role() = 'admin') with check (public.mcj_current_role() = 'admin');
exception when duplicate_object then null; end $$;

-- MCJ V1 seed test accounts. Auth users were created via Supabase Admin API for this project.
create unique index if not exists idx_companion_profiles_user_unique on public.companion_profiles(user_id);

insert into public.profiles (id, role, display_name, email, phone, avatar_url, status)
values
  ('6f31b706-11e7-42df-8db1-d2caccd796de', 'admin', '管理员', 'admin@meow.test', '', '', 'active'),
  ('9004a2b2-5ad7-4e10-8416-613f3de30ded', 'customer_service', '客服测试账号', 'service@meow.test', '', '', 'active'),
  ('c776e811-6003-48a4-8f11-ed9eb1b70898', 'companion', '陪玩测试账号', 'companion@meow.test', '', '', 'active'),
  ('89bbc343-d508-4539-b4d1-2b42949936a6', 'boss', '老板测试账号', 'boss@meow.test', '', '', 'active')
on conflict (id) do update set
  role = excluded.role,
  display_name = excluded.display_name,
  email = excluded.email,
  phone = excluded.phone,
  avatar_url = excluded.avatar_url,
  status = excluded.status;

insert into public.companion_profiles (
  user_id,
  nickname,
  game,
  level_name,
  price,
  commission_rate,
  deposit_status,
  verification_status,
  online_status,
  description,
  voice_url,
  card_image_url
)
values (
  'c776e811-6003-48a4-8f11-ed9eb1b70898',
  '测试陪玩',
  '综合游戏',
  'Lv.1 萌喵',
  30,
  20,
  'paid',
  'approved',
  'online',
  '上线测试陪玩资料',
  '',
  ''
)
on conflict (user_id) do update set
  nickname = excluded.nickname,
  game = excluded.game,
  level_name = excluded.level_name,
  price = excluded.price,
  commission_rate = excluded.commission_rate,
  deposit_status = excluded.deposit_status,
  verification_status = excluded.verification_status,
  online_status = excluded.online_status,
  description = excluded.description,
  voice_url = excluded.voice_url,
  card_image_url = excluded.card_image_url,
  updated_at = now();

-- Payment setup for boss recharge center.
create table if not exists public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null default '',
  is_enabled boolean not null default false,
  api_base_url text not null default '',
  merchant_id text not null default '',
  api_key text not null default '',
  api_secret text not null default '',
  callback_secret text not null default '',
  redirect_url text not null default '',
  callback_url text not null default '',
  mode text not null default 'test',
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  payment_no text not null unique,
  boss_id uuid not null references public.profiles(id),
  amount numeric(10,2) not null default 0,
  cat_food_amount numeric(10,2) not null default 0,
  payment_method text not null default '',
  status text not null default 'pending',
  payment_url text not null default '',
  raw_response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists idx_payment_methods_enabled_sort on public.payment_methods(is_enabled, sort_order);
create index if not exists idx_payment_orders_boss_created on public.payment_orders(boss_id, created_at desc);
create index if not exists idx_payment_orders_status_created on public.payment_orders(status, created_at desc);

alter table public.payment_methods enable row level security;
alter table public.payment_orders enable row level security;

do $$ begin
  create policy "payment_methods_admin_read" on public.payment_methods for select using (public.mcj_current_role() = 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "payment_orders_owner_admin_read" on public.payment_orders for select using (boss_id = auth.uid() or public.mcj_current_role() = 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "payment_methods_admin_all" on public.payment_methods for all using (public.mcj_current_role() = 'admin') with check (public.mcj_current_role() = 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "payment_orders_admin_all" on public.payment_orders for all using (public.mcj_current_role() = 'admin') with check (public.mcj_current_role() = 'admin');
exception when duplicate_object then null; end $$;

insert into public.payment_methods (code, name, is_enabled, sort_order, mode)
values
  ('tng', 'TNG', false, 10, 'test'),
  ('alipay', '支付宝', false, 20, 'test'),
  ('bank', '银行支付', false, 30, 'test')
on conflict (code) do update set
  name = excluded.name,
  sort_order = excluded.sort_order,
  updated_at = now();

-- Fixed service packages for 更多玩法.
create table if not exists public.service_packages (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  game text not null default '',
  category text not null default '',
  fixed_price numeric(10,2) not null default 0,
  duration_minutes integer not null default 60,
  level_min integer not null default 1,
  level_max integer not null default 5,
  description text not null default '',
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_service_packages_active_sort on public.service_packages(is_active, sort_order);
create index if not exists idx_service_packages_game on public.service_packages(game);

alter table public.service_packages enable row level security;

do $$ begin
  create policy "service_packages_public_read_active" on public.service_packages for select using (is_active = true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "service_packages_admin_all" on public.service_packages for all using (public.mcj_current_role() = 'admin') with check (public.mcj_current_role() = 'admin');
exception when duplicate_object then null; end $$;
