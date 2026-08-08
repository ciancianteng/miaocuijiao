-- Friday unified settlement center: batches + boss refund payouts.
-- Additive only. No DROP / TRUNCATE of financial data.
-- Asia/Kuala_Lumpur week codes: MCJ-PAYOUT-YYYY-Www

create extension if not exists pgcrypto;

-- ── settlement_batches ──────────────────────────────────────────────
create table if not exists public.settlement_batches (
  id uuid primary key default gen_random_uuid(),
  batch_code text not null unique,
  week_year integer not null,
  week_number integer not null,
  week_start date not null,
  week_end date not null,
  timezone text not null default 'Asia/Kuala_Lumpur',
  status text not null default 'open'
    check (status in ('open', 'processing', 'closed', 'carried_forward')),
  refund_total_rm numeric(14,2) not null default 0,
  companion_wage_total_rm numeric(14,2) not null default 0,
  cs_wage_total_rm numeric(14,2) not null default 0,
  total_count integer not null default 0,
  paid_count integer not null default 0,
  failed_count integer not null default 0,
  pending_amount_rm numeric(14,2) not null default 0,
  paid_amount_rm numeric(14,2) not null default 0,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_settlement_batches_week
  on public.settlement_batches(week_year, week_number);

-- ── boss_refund_requests (Friday bank payout, not instant wallet) ───
create table if not exists public.boss_refund_requests (
  id uuid primary key default gen_random_uuid(),
  refund_no text not null unique,
  order_id uuid not null,
  order_no text not null default '',
  boss_id uuid not null references public.profiles(id),
  boss_uid text not null default '',
  boss_name text not null default '',
  amount_rm numeric(12,2) not null default 0,
  currency text not null default 'MYR',
  reason text not null default '',
  cs_suggest text not null default ''
    check (cs_suggest in ('', 'approve', 'reject')),
  cs_note text not null default '',
  assigned_cs_id uuid,
  assigned_cs_name text not null default '',
  assigned_cs_account text not null default '',
  status text not null default 'pending_review'
    check (status in (
      'pending_review','approved_for_payout','included_in_batch','processing',
      'paid','rejected','failed','carried_forward','cancelled'
    )),
  settlement_date date,
  batch_id uuid references public.settlement_batches(id),
  payout_request_id uuid,
  bank_name text not null default '',
  account_name text not null default '',
  account_number_masked text not null default '',
  paid_amount_rm numeric(12,2),
  paid_at timestamptz,
  paid_by uuid,
  bank_reference text not null default '',
  receipt_bucket text not null default '',
  receipt_path text not null default '',
  receipt_version integer not null default 1,
  reject_reason text not null default '',
  fail_reason text not null default '',
  can_reapply boolean not null default true,
  reviewed_at timestamptz,
  reviewed_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_boss_refund_requests_boss
  on public.boss_refund_requests(boss_id, created_at desc);
create index if not exists idx_boss_refund_requests_order
  on public.boss_refund_requests(order_id, status);
create index if not exists idx_boss_refund_requests_status_settle
  on public.boss_refund_requests(status, settlement_date);

-- ── Extend payout_requests for boss refund + batch + failed ─────────
alter table public.payout_requests
  drop constraint if exists payout_requests_applicant_type_check;

alter table public.payout_requests
  add constraint payout_requests_applicant_type_check
  check (applicant_type in ('companion', 'customer_service', 'boss'));

alter table public.payout_requests
  add column if not exists payout_type text not null default 'other';
alter table public.payout_requests
  add column if not exists batch_id uuid references public.settlement_batches(id);
alter table public.payout_requests
  add column if not exists fail_reason text not null default '';

do $$
declare
  r record;
begin
  for r in
    select con.conname as cname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'payout_requests'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%status%'
  loop
    execute format('alter table public.payout_requests drop constraint %I', r.cname);
  end loop;
end $$;

alter table public.payout_requests
  add constraint payout_requests_status_check
  check (status in (
    'submitted','pending_friday','reviewing','approved','pending_payment',
    'paid','completed','rejected','rolled_over','failed','processing'
  ));

-- companion / staff status: allow failed
do $$
declare
  r record;
begin
  for r in
    select con.conname as cname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'companion_withdrawals'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%status%'
  loop
    execute format('alter table public.companion_withdrawals drop constraint %I', r.cname);
  end loop;
end $$;

alter table public.companion_withdrawals
  add constraint companion_withdrawals_status_check
  check (status in (
    'submitted','pending_friday','reviewing','approved','pending_payment','paid','completed','rejected','rolled_over','failed',
    'pending','pending_review','approved_pending_pay','paying','paid_pending_receipt','pay_failed','cancelled'
  ));

do $$
declare
  r record;
begin
  for r in
    select con.conname as cname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'staff_payrolls'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%status%'
  loop
    execute format('alter table public.staff_payrolls drop constraint %I', r.cname);
  end loop;
end $$;

alter table public.staff_payrolls
  add constraint staff_payrolls_status_check
  check (status in (
    'submitted','pending_friday','reviewing','approved','pending_payment','paid','completed','rejected','rolled_over','failed',
    'draft','pending','pending_review','approved_pending_pay','paying','paid_pending_receipt','pay_failed','cancelled'
  ));

alter table public.companion_withdrawals
  add column if not exists batch_id uuid references public.settlement_batches(id);
alter table public.staff_payrolls
  add column if not exists batch_id uuid references public.settlement_batches(id);

-- Refund receipt version history (never overwrite)
create table if not exists public.payout_receipt_versions (
  id uuid primary key default gen_random_uuid(),
  related_table text not null,
  related_record_id uuid not null,
  version integer not null default 1,
  storage_bucket text not null default 'finance-receipts',
  storage_path text not null,
  original_file_name text not null default '',
  mime_type text not null default '',
  file_size integer not null default 0,
  bank_reference text not null default '',
  paid_amount_rm numeric(12,2),
  uploaded_by uuid,
  created_at timestamptz not null default now(),
  unique (related_table, related_record_id, version)
);

grant select, insert, update, delete on public.settlement_batches to service_role;
grant select on public.settlement_batches to authenticated;
grant select, insert, update, delete on public.boss_refund_requests to service_role;
grant select on public.boss_refund_requests to authenticated;
grant select, insert, update, delete on public.payout_receipt_versions to service_role;

notify pgrst, 'reload schema';
