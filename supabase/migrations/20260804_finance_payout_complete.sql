-- Finance payout audit logs + payroll wage breakdown columns.
-- Safe to re-run.

create extension if not exists pgcrypto;

create table if not exists public.finance_payout_logs (
  id uuid primary key default gen_random_uuid(),
  log_no text not null unique,
  payout_type text not null default 'other',
  related_record_id uuid,
  payment_id uuid,
  receipt_id uuid,
  payee_user_id uuid,
  payee_name text not null default '',
  payee_uid text not null default '',
  amount_rm numeric(12,2) not null default 0,
  bank_reference text not null default '',
  receipt_path text not null default '',
  receipt_file_type text not null default '',
  notes text not null default '',
  admin_id uuid,
  admin_name text not null default '',
  admin_role text not null default '',
  client_ip text not null default '',
  action text not null default 'confirm_paid',
  created_at timestamptz not null default now()
);

create index if not exists idx_finance_payout_logs_created
  on public.finance_payout_logs(created_at desc);
create index if not exists idx_finance_payout_logs_type
  on public.finance_payout_logs(payout_type, created_at desc);

alter table public.staff_payrolls
  add column if not exists commission_rm numeric(12,2) not null default 0;
alter table public.staff_payrolls
  add column if not exists wage_breakdown jsonb not null default '{}'::jsonb;

create table if not exists public.staff_notifications (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.profiles(id),
  title text not null default '',
  body text not null default '',
  kind text not null default 'system',
  related_id text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_staff_notifications_staff
  on public.staff_notifications(staff_id, created_at desc);

grant select, insert, update, delete on public.finance_payout_logs to service_role;
grant select on public.finance_payout_logs to authenticated;
grant select, insert, update, delete on public.staff_notifications to service_role;
grant select on public.staff_notifications to authenticated;

notify pgrst, 'reload schema';
