create extension if not exists "pgcrypto";

create table if not exists public.players (
  id text primary key,
  uid text unique not null,
  player_uid text unique,
  role text not null default 'companion',
  companion_enabled boolean not null default true,
  can_access_companion boolean not null default true,
  email text unique,
  phone text,
  contact_phone text,
  password_hash text,
  name text,
  nickname text,
  avatar_url text,
  age integer,
  gender text,
  region text,
  main_game text,
  game text,
  game_id text,
  rank text,
  position text,
  tags jsonb not null default '[]'::jsonb,
  bio text,
  schedule text,
  available_time text,
  current_price numeric(12,2) not null default 0,
  default_price numeric(12,2) not null default 0,
  level_id text,
  level_name text,
  audit_status text not null default '待提交',
  approval_status text,
  profile_audit_status text,
  identity_status text not null default '未认证',
  contact_status text not null default '未认证',
  bank_status text not null default '未认证',
  deposit_status text not null default '未缴纳',
  status text not null default '启用',
  account_status text,
  online_status text not null default '离线',
  work_status text not null default '暂停接单',
  bank_name text,
  bank_account text,
  order_commission_rate numeric(5,2) not null default 80,
  gift_commission_rate numeric(5,2) not null default 0,
  direct_rebate_rate numeric(5,2) not null default 0,
  featured boolean not null default false,
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);
create index if not exists players_status_idx on public.players (status, audit_status, online_status);
create index if not exists players_game_idx on public.players (main_game);

create table if not exists public.bosses (
  id text primary key,
  uid text unique not null,
  boss_id text unique,
  role text not null default 'boss',
  email text unique,
  phone text,
  password_hash text,
  nickname text,
  avatar_url text,
  status text not null default '正常',
  total_orders integer not null default 0,
  total_spent numeric(12,2) not null default 0,
  total_refund numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table if not exists public.customer_service_staff (
  id text primary key,
  uid text unique,
  role text not null default 'customer_service',
  email text unique,
  phone text,
  password_hash text,
  name text,
  nickname text,
  avatar_url text,
  status text not null default '启用',
  shift text,
  online_status text not null default '离线',
  clocked_in boolean not null default false,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.orders add column if not exists appointment_at timestamptz;
alter table public.orders add column if not exists duration text;
alter table public.orders add column if not exists player_id text;
alter table public.orders add column if not exists customer_service_id text;
alter table public.orders add column if not exists service_staff_name text;
alter table public.orders add column if not exists grabber_count integer not null default 0;
alter table public.orders add column if not exists required_level text;
alter table public.orders add column if not exists required_tags jsonb not null default '[]'::jsonb;
alter table public.orders add column if not exists allow_multiple_candidates boolean not null default false;
alter table public.orders add column if not exists actual_start_at timestamptz;
alter table public.orders add column if not exists actual_end_at timestamptz;
alter table public.orders add column if not exists completion_note text;

create table if not exists public.order_grabs (
  id text primary key,
  order_id text not null references public.orders(id) on delete cascade,
  player_id text not null,
  player_uid text,
  player_name text,
  status text not null default '待老板确认',
  fail_reason text,
  created_at timestamptz not null default now(),
  unique(order_id, player_id)
);

create table if not exists public.conversations (
  id text primary key,
  type text,
  category text,
  name text,
  uid text,
  boss_uid text,
  customer_uid text,
  order_id text,
  assigned_service text,
  assigned_service_name text,
  status text not null default '待接入',
  avatar_url text,
  last_message text,
  last_time timestamptz,
  unread_count integer not null default 0,
  player_unread_count integer not null default 0,
  profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null references public.conversations(id) on delete cascade,
  sender_id text,
  sender_role text not null,
  type text not null default 'text',
  content text not null default '',
  card_payload jsonb,
  quote_message_id text,
  reply_to_content text,
  read_at timestamptz,
  recalled_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists messages_conversation_time_idx on public.messages (conversation_id, created_at);

create table if not exists public.player_verifications (
  id text primary key,
  player_id text not null references public.players(id) on delete cascade,
  player_uid text,
  real_name text,
  identity_no text,
  phone text,
  bank_name text,
  bank_account text,
  remark text,
  identity_status text not null default '审核中',
  contact_status text not null default '审核中',
  bank_status text not null default '审核中',
  audit_status text not null default '待审核',
  created_at timestamptz not null default now()
);

create table if not exists public.player_deposits (
  id text primary key,
  player_id text not null references public.players(id) on delete cascade,
  player_uid text,
  required_amount numeric(12,2) not null default 100,
  paid_amount numeric(12,2) not null default 0,
  payment_method text,
  proof_url text,
  remark text,
  status text not null default '待审核',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table if not exists public.player_earnings (
  id text primary key,
  player_id text not null references public.players(id) on delete cascade,
  player_uid text,
  order_id text,
  type text not null default '订单收入',
  amount numeric(12,2) not null default 0,
  platform_fee numeric(12,2) not null default 0,
  direct_rebate numeric(12,2) not null default 0,
  status text not null default '可提现',
  created_at timestamptz not null default now()
);

create table if not exists public.withdrawal_requests (
  id text primary key,
  player_id text not null references public.players(id) on delete cascade,
  player_uid text,
  amount numeric(12,2) not null default 0,
  account text,
  remark text,
  status text not null default '待审核',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table if not exists public.games (
  id text primary key,
  name text not null,
  short_name text,
  category text,
  platform text,
  icon_url text,
  cover_url text,
  enabled boolean not null default true,
  hot boolean not null default false,
  show_home boolean not null default false,
  application_enabled boolean not null default true,
  order_enabled boolean not null default true,
  sort integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tags (
  id text primary key,
  name text not null,
  category text not null default '陪玩标签',
  enabled boolean not null default true,
  self_selectable boolean not null default true,
  require_review boolean not null default false,
  show_hall boolean not null default true,
  filterable boolean not null default true,
  sort integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.companion_levels (
  id text primary key,
  code text,
  name text not null,
  min_price numeric(12,2) not null default 0,
  max_price numeric(12,2),
  icon_url text,
  color text,
  description text,
  default_commission_rate numeric(5,2) not null default 80,
  default_gift_commission_rate numeric(5,2) not null default 0,
  default_direct_rebate_rate numeric(5,2) not null default 0,
  enabled boolean not null default true,
  sort integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.attendance_records (
  id text primary key,
  staff_id text not null references public.customer_service_staff(id) on delete cascade,
  work_date date not null,
  clock_in_at timestamptz,
  clock_out_at timestamptz,
  work_hours numeric(8,2) not null default 0,
  status text,
  created_at timestamptz not null default now(),
  unique(staff_id, work_date)
);

create table if not exists public.quick_replies (
  id text primary key,
  category text,
  title text,
  content text not null,
  enabled boolean not null default true,
  sort integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.operation_logs (
  id uuid primary key default gen_random_uuid(),
  module text not null,
  action text not null,
  operator_id text,
  operator_role text,
  target_id text,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.password_reset_requests (
  id text primary key,
  account text not null,
  role text not null,
  status text not null default '待处理',
  created_at timestamptz not null default now()
);

insert into public.companion_levels (id, code, name, min_price, max_price, sort)
values
  ('lv1','Lv.1','萌喵',20,30,1),
  ('lv2','Lv.2','灵喵',30,40,2),
  ('lv3','Lv.3','猎喵',40,45,3),
  ('lv4','Lv.4','喵神',60,75,4),
  ('lv5','Lv.5','喵皇',75,100,5)
on conflict (id) do nothing;
