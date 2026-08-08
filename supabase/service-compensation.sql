-- service-compensation.sql
-- 客服补偿申请表。请在 Supabase SQL Editor 中执行本文件。
-- 执行前不会自动建表；接口在表缺失时会返回明确提示，不会伪装已成功。

create table if not exists public.compensation_requests (
  id uuid primary key default gen_random_uuid(),
  boss_id uuid not null references public.profiles(id),
  related_order_id uuid,
  request_type text not null default 'after_sale',
  suggested_amount numeric(12,2) not null check (suggested_amount > 0),
  approved_amount numeric(12,2),
  balance_type text not null default 'bonus' check (balance_type in ('paid', 'bonus')),
  reason text not null default '',
  staff_note text not null default '',
  evidence_urls text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  applicant_id uuid references public.profiles(id),
  reviewer_id uuid references public.profiles(id),
  review_note text not null default '',
  notify_boss boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists idx_compensation_status_created
  on public.compensation_requests (status, created_at desc);

alter table public.compensation_requests enable row level security;
