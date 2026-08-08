create extension if not exists "pgcrypto";

create table if not exists public.orders (
  id text primary key,
  order_type text not null default '普通陪玩订单',
  boss_name text,
  boss_uid text,
  boss_id text,
  player_name text,
  player_uid text,
  game text,
  game_id text,
  server text,
  service_content text,
  service_duration text,
  appointment_time timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  expected_end_at timestamptz,
  service_staff text,
  created_service_staff text,
  current_service_staff text,
  amount numeric(12,2) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  actual_paid_amount numeric(12,2) not null default 0,
  player_commission_rate numeric(5,2) not null default 80,
  player_income numeric(12,2) not null default 0,
  platform_fee numeric(12,2) not null default 0,
  direct_rebate numeric(12,2) not null default 0,
  club_share numeric(12,2) not null default 0,
  refund_amount numeric(12,2) not null default 0,
  platform_profit numeric(12,2) not null default 0,
  payment_status text not null default '未支付',
  order_status text not null default '待支付',
  settlement_status text not null default '待结算',
  order_source text not null default '平台直营',
  source_club_id text,
  source_club_name text,
  third_party_payment_no text,
  payment_order_no text,
  service_remark text,
  admin_remark text,
  last_admin_action text,
  last_admin_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_order_status_check check (order_status in ('待支付','待接单','待老板确认陪玩','待开始','进行中','待确认完成','已完成','已取消','售后处理中','退款处理中','已退款','异常订单')),
  constraint orders_payment_status_check check (payment_status in ('未支付','支付中','已支付','支付失败','部分退款','已退款')),
  constraint orders_order_source_check check (order_source in ('平台直营','合作俱乐部','推广渠道','客服创建','老板自助下单'))
);

create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists orders_boss_uid_idx on public.orders (boss_uid);
create index if not exists orders_player_uid_idx on public.orders (player_uid);
create index if not exists orders_status_idx on public.orders (order_status, payment_status);

create table if not exists public.order_after_sales (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.orders(id),
  applicant_type text,
  applicant_uid text,
  reason text,
  evidence jsonb not null default '[]'::jsonb,
  requested_amount numeric(12,2) not null default 0,
  approved_amount numeric(12,2) not null default 0,
  responsibility text,
  handler text,
  audit_result text,
  admin_remark text,
  created_at timestamptz not null default now(),
  handled_at timestamptz
);

create table if not exists public.order_operation_logs (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.orders(id),
  action text not null,
  operator_role text,
  reason text,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz not null default now()
);
